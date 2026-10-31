import * as T from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// Keep the source/character edges at full resolution. Only the soft halo is
// sampled at half width/height (one quarter of the expensive 8-tap fragments).
// Orthographic camera zoom changes the visible scene size, not camera.far.
// Only a deliberate close-up may add a hint of depth-of-field. A whole-room
// shot remains entirely sharp, even when character style is illustrated.
export function dreamcoreFocusStrength(camera,{edit=false,overview=false,firstPerson=false}={}){
 if(!camera?.isOrthographicCamera||edit||overview||firstPerson)return 0;
 const zoom=Math.max(.001,Number(camera.zoom)||1);
 const visibleHeight=Math.abs(camera.top-camera.bottom)/zoom;
 if(!Number.isFinite(visibleHeight))return 0;
 return 1-T.MathUtils.smoothstep(visibleHeight,2.15,4.25);
}
export function createRoomFinishPass(renderer){
 let texture=null,halo=null,width=0,height=0;const size=new T.Vector2();
 // The illustrated look reuses its ONE original room draw with a hardware
 // depth attachment. Other styles still use the original framebuffer path.
 let sceneBuffer=null,blurHorizontal=null,defocused=null,captured=false;
 // Separable, compact Gaussian blur: neighboring pixels contribute a smooth
 // continuous profile, never eight detached silhouette copies. Depth weights
 // prevent foreground people from bleeding into the distant room.
 const depthBlurMaterial=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{source:{value:null},depth:{value:null},texel:{value:new T.Vector2()},direction:{value:new T.Vector2(1,0)},radius:{value:1.5}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`varying vec2 vUv;uniform sampler2D source;uniform sampler2D depth;
   uniform vec2 texel;uniform vec2 direction;uniform float radius;
   vec3 readSource(vec2 uv){return texture2D(source,clamp(uv,vec2(0.),vec2(1.))).rgb;}
   void main(){
    float centerDepth=texture2D(depth,vUv).r;
    vec3 weightedColor=readSource(vUv)*.38;
    float sumWeight=.38;
    for(int j=1;j<=3;j++){
     float k=float(j);
     float w=j==1?.24:j==2?.065:.005;
     vec2 offset=direction*texel*radius*k;
     vec2 uvPlus=clamp(vUv+offset,vec2(0.),vec2(1.));
     vec2 uvMinus=clamp(vUv-offset,vec2(0.),vec2(1.));
     float nearPlus=1.-smoothstep(.001,.008,abs(texture2D(depth,uvPlus).r-centerDepth));
     float nearMinus=1.-smoothstep(.001,.008,abs(texture2D(depth,uvMinus).r-centerDepth));
     weightedColor+=readSource(uvPlus)*(w*nearPlus)+readSource(uvMinus)*(w*nearMinus);
     sumWeight+=w*(nearPlus+nearMinus);
    }
    gl_FragColor=vec4(weightedColor/max(sumWeight,.001),1.);
   }`});
 const depthBlurQuad=new FullScreenQuad(depthBlurMaterial);
 const glowMaterial=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{source:{value:null},pixel:{value:new T.Vector2()}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`varying vec2 vUv;uniform sampler2D source;uniform vec2 pixel;
   vec3 bright(vec2 p){vec3 c=sRGBTransferEOTF(texture2D(source,p)).rgb;return c*smoothstep(.58,.94,max(c.r,max(c.g,c.b)));}
   void main(){vec3 halo=vec3(0.);for(int i=0;i<8;i++){float a=float(i)*.78539816;halo+=bright(vUv+vec2(cos(a),sin(a))*pixel*4.);}gl_FragColor=vec4(halo/8.,1.);}`});
 const material=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{source:{value:null},halo:{value:null},depth:{value:null},defocused:{value:null},focusDepth:{value:.5},cameraSpan:{value:100},depthOfField:{value:0},sourceLinear:{value:0},glow:{value:.12},warmth:{value:0},detail:{value:0},finishOn:{value:1},artStyle:{value:0},pixel:{value:new T.Vector2()}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`varying vec2 vUv;uniform sampler2D source;uniform sampler2D halo;uniform float glow;uniform float warmth;
   uniform float detail;uniform float finishOn;uniform float artStyle;uniform vec2 pixel;
   uniform sampler2D depth;uniform sampler2D defocused;uniform float focusDepth;uniform float cameraSpan;uniform float depthOfField;uniform float sourceLinear;
   vec3 sceneColor(vec2 uv){vec4 sampleColor=texture2D(source,clamp(uv,vec2(0.),vec2(1.)));return mix(sRGBTransferEOTF(sampleColor).rgb,sampleColor.rgb,sourceLinear);}
   void main(){
    vec3 c=sceneColor(vUv);
    if(artStyle>.5&&depthOfField>.001){
     float rawDepth=texture2D(depth,vUv).r;
     float metres=(rawDepth-focusDepth)*cameraSpan;
     // Actual orthographic view depth, not a screen-centre fog vignette.
     // Only a gentle lens transition once the user zooms into a portrait.
     // Prevent the entire room from turning to blocky half-res blur.
     float farBlur=smoothstep(1.5,5.5,metres);
     float nearBlur=smoothstep(2.0,6.5,-metres)*.12;
     float aperture=clamp(max(farBlur,nearBlur)*depthOfField*.21,0.,.21);
     c=mix(c,texture2D(defocused,vUv).rgb,aperture);
    }
    float l=dot(c,vec3(.2126,.7152,.0722));
    // ReShade/CAS-inspired local contrast is optional and strictly post-render.
    // Never touch character shaders, authored textures, or original light/shadow values.
    // Shade smooth mid-tones gently, avoid white skin highlights and black outlines.
    if(detail>.001){
     vec3 near=(sceneColor(vUv+vec2(pixel.x*1.5,0.))+sceneColor(vUv-vec2(pixel.x*1.5,0.))
               +sceneColor(vUv+vec2(0.,pixel.y*1.5))+sceneColor(vUv-vec2(0.,pixel.y*1.5)))*.25;
     float weight=smoothstep(.045,.18,l)*(1.-smoothstep(.78,.98,l));
     vec3 micro=clamp(c-near,vec3(-.055),vec3(.055));
     c=max(c+micro*detail*weight,vec3(0.));
     // ReShade-like midtone depth: deepens only existing shaded midtones.
     // Pure blacks, skin highlights, window glare and paper-white walls stay put.
     float shadedMidtones=smoothstep(.10,.26,l)*(1.-smoothstep(.48,.73,l));
     c*=1.-detail*.085*shadedMidtones;
    }
    if(finishOn>.5){
     // Original finish math: unchanged, including all four time-of-day glow strengths.
     vec3 bloom=texture2D(halo,vUv).rgb;
     c=mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,1.04);c=(c-.18)*1.025+.18;
     c+=bloom*glow*(1.-clamp(c,0.,1.)) + vec3(.012,.005,0.)*warmth*smoothstep(.35,.85,l);
    }
    if(artStyle>.5){
     // Regrade the actual scene into painted light and shadow rather than
     // lifting every material into flat pastel. Retain the original textures.
     float inkLuma=dot(c,vec3(.2126,.7152,.0722));
     float plane=smoothstep(.20,.82,inkLuma);
     // An airy film-print split tone: lavender-blue shadows and warm cream
     // highlights, rather than a grey blanket over the whole room.
     vec3 inkGrade=mix(vec3(.845,.923,1.104),vec3(1.147,1.068,.974),plane);
     c*=inkGrade;
     float midWeight=smoothstep(.07,.27,inkLuma)*(1.-smoothstep(.78,.97,inkLuma));
     c+=vec3((inkLuma-.46)*.31)*midWeight;
     // Keep a tangible, delicate pastel veil in mids while preserving eyes,
     // black fabric, windows and whites. Inspired by Amian's film/grade mix,
     // not by the many costly DOF and AO effects enabled in that preset.
     float inkFilm=smoothstep(.13,.33,inkLuma)*(1.-smoothstep(.81,.98,inkLuma));
     c=mix(c,c*vec3(.972,.984,1.015)+vec3(.035,.022,.028),inkFilm*.82);
     float paintLuma=dot(c,vec3(.2126,.7152,.0722));
     c+= (c-vec3(paintLuma))*.12*midWeight;
     c=max(c,vec3(0.));
     // A thin, luminous paper veil over midtones only. Avoid flat fog over
     // dark hair, eyes, bright skin and white walls; keep authored detail.
     float paperMask=smoothstep(.09,.36,inkLuma)*(1.-smoothstep(.81,.98,inkLuma));
     c=mix(c,c*vec3(.968,.982,1.012)+vec3(.027,.021,.028),paperMask*.88);
     // Joyce Comic.fx-inspired CURRENT-PIXEL ink. The four surrounding
     // texels are edge DETECTORS only; their colours NEVER enter the output.
     // Unlike fake depth of field this cannot superimpose shifted copies of
     // furniture, residents, hair, walls or moving objects.
     vec3 leftInk=sceneColor(vUv-vec2(pixel.x,0.));
     vec3 rightInk=sceneColor(vUv+vec2(pixel.x,0.));
     vec3 upInk=sceneColor(vUv+vec2(0.,pixel.y));
     vec3 downInk=sceneColor(vUv-vec2(0.,pixel.y));
     vec3 outlineDx=rightInk-leftInk;
     vec3 outlineDy=upInk-downInk;
     float colourDiscontinuity=max(length(outlineDx),length(outlineDy));
     // One-pixel current-sample drawing, with a stronger response to the
     // pale furniture / clothing borders that used to disappear entirely.
     float outlineStrength=smoothstep(.095,.34,colourDiscontinuity);
     // Ink the boundary pixel itself, never an offset silhouette.
     // Keep light, detailed surfaces crisp without filling them with black.
     float inkWeight=outlineStrength*mix(.25,.44,smoothstep(.10,.79,paintLuma));
     c=mix(c,vec3(.075,.064,.100),inkWeight);
     // Faint pink/cyan pigment sits on the detected edge pixel itself.
     // There are no offset image copies, so moving characters do not ghost.
     float edgeSign=dot(outlineDx+outlineDy,vec3(.20,.63,.17));
     vec3 colouredInk=edgeSign>0.?vec3(.91,.56,.73):vec3(.47,.77,.91);
     // Only a narrow pink/cyan pencil tint on the lighter edge pixel:
     // do not sample displaced scene copies or extend an RGB ghost fringe.
     float edgeLight=dot(c,vec3(.2126,.7152,.0722));
     float outerPaper=smoothstep(.17,.53,edgeLight);
     float colouredEdge=outlineStrength*.185*outerPaper
                       *(1.-smoothstep(.94,1.03,paintLuma));
     c=mix(c,colouredInk,colouredEdge);
     // Static fine-grain, applied after the lens pass. It is deliberately
     // weakest over clean whites, near-blacks, pupils and dark linework.
     vec2 grainCell=floor(gl_FragCoord.xy*.82);
     float noise=fract(sin(dot(grainCell,vec2(12.9898,78.233)))*43758.5453)-.5;
     float grainMask=smoothstep(.045,.18,inkLuma)*(1.-smoothstep(.85,1.04,inkLuma));
     float paperTooth=fract(sin(dot(floor(gl_FragCoord.xy*.31),vec2(31.123,57.179)))*31758.5453)-.5;
     // Tiny fixed-grain paper fibers: clearly visible at arm's length,
     // but almost invisible over pupils and clean highlights.
     c+=vec3(noise*.030+paperTooth*.012)*grainMask;
    }
    gl_FragColor=vec4(max(c,0.),1.);
    #include <colorspace_fragment>
   }`});
 const quad=new FullScreenQuad(material);
 const glowQuad=new FullScreenQuad(glowMaterial);
 function ensureCapture(){
  renderer.getDrawingBufferSize(size);
  if(sceneBuffer&&(sceneBuffer.width!==size.x||sceneBuffer.height!==size.y)){
   sceneBuffer.depthTexture.dispose();sceneBuffer.dispose();sceneBuffer=null;
   blurHorizontal?.dispose();blurHorizontal=null;
   defocused?.dispose();defocused=null;
  }
  if(!sceneBuffer){
   sceneBuffer=new T.WebGLRenderTarget(size.x,size.y,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:true,stencilBuffer:false,colorSpace:T.SRGBColorSpace});
   sceneBuffer.depthTexture=new T.DepthTexture(size.x,size.y,T.UnsignedIntType);
   sceneBuffer.depthTexture.format=T.DepthFormat;
   const blurWidth=Math.max(1,Math.ceil(size.x/2)),blurHeight=Math.max(1,Math.ceil(size.y/2));
   blurHorizontal=new T.WebGLRenderTarget(blurWidth,blurHeight,{depthBuffer:false,stencilBuffer:false,minFilter:T.LinearFilter,magFilter:T.LinearFilter});
   defocused=new T.WebGLRenderTarget(blurWidth,blurHeight,{depthBuffer:false,stencilBuffer:false,minFilter:T.LinearFilter,magFilter:T.LinearFilter});
  }
 }
 return {
 beginScene(){
  if(!renderer.capabilities.isWebGL2)return false;
  ensureCapture();captured=true;renderer.setRenderTarget(sceneBuffer);return true;
 },
 render(phase,{baseFinish=true,detail=0,illustrated=false,focusDepth=.5,cameraSpan=100,depthStrength=0}={}){
  renderer.getDrawingBufferSize(size);
  if(width!==size.x||height!==size.y){
   texture?.dispose();halo?.dispose();width=size.x;height=size.y;
   texture=new T.FramebufferTexture(width,height);texture.colorSpace=T.NoColorSpace;
   texture.minFilter=texture.magFilter=T.LinearFilter;
   halo=new T.WebGLRenderTarget(Math.ceil(width/2),Math.ceil(height/2),{depthBuffer:false,stencilBuffer:false});
   material.uniforms.halo.value=halo.texture;
  }
  const withDepth=captured&&illustrated&&sceneBuffer&&defocused;
  captured=false;
  material.uniforms.source.value=glowMaterial.uniforms.source.value=withDepth?sceneBuffer.texture:texture;
  material.uniforms.depth.value=withDepth?sceneBuffer.depthTexture:null;
  material.uniforms.defocused.value=withDepth?defocused.texture:null;
  material.uniforms.focusDepth.value=T.MathUtils.clamp(Number(focusDepth)||.5,0,1);
  material.uniforms.cameraSpan.value=Math.max(1,Number(cameraSpan)||100);
  material.uniforms.depthOfField.value=withDepth?T.MathUtils.clamp(depthStrength,0,1):0;
  // WebGL decodes sRGB colour attachments on sampling; the original
  // framebuffer copy has untagged encoded pixels and still needs EOTF.
  material.uniforms.sourceLinear.value=withDepth?1:0;
  glowMaterial.uniforms.pixel.value.set(1/width,1/height);
  material.uniforms.pixel.value.set(1/width,1/height);
  material.uniforms.detail.value=T.MathUtils.clamp(Number(detail)||0,0,.7);
  material.uniforms.artStyle.value=illustrated?1:0;
  material.uniforms.finishOn.value=baseFinish?1:0;
  // The Comic preset enables edge ink, not an image-copy DOF or bloom halo.
  // Keep all original bloom settings for modern/legacy; ink mode has none.
  material.uniforms.glow.value=baseFinish&&!illustrated?(phase==='sunset'?.22:phase==='morning'?.14:phase==='night'?.12:.07):0;
  material.uniforms.warmth.value=baseFinish?(phase==='sunset'?1:phase==='night'?.45:0):0;
  if(!withDepth)renderer.copyFramebufferToTexture(texture);
  const clear=renderer.autoClear,target=withDepth?null:renderer.getRenderTarget();renderer.autoClear=false;
  try{
   if(withDepth&&depthStrength>0){
    depthBlurMaterial.uniforms.depth.value=sceneBuffer.depthTexture;
    // Radius is expressed in half-resolution texels. Clamp it on Android:
    // a broad 24px ring produced the reported window/wardrobe ghosts.
    depthBlurMaterial.uniforms.radius.value=T.MathUtils.clamp(Math.min(width,height)*.0025,.65,1.15);
    depthBlurMaterial.uniforms.texel.value.set(1/blurHorizontal.width,1/blurHorizontal.height);
    depthBlurMaterial.uniforms.source.value=sceneBuffer.texture;
    depthBlurMaterial.uniforms.direction.value.set(1,0);
    renderer.setRenderTarget(blurHorizontal);depthBlurQuad.render(renderer);
    depthBlurMaterial.uniforms.source.value=blurHorizontal.texture;
    depthBlurMaterial.uniforms.direction.value.set(0,1);
    renderer.setRenderTarget(defocused);depthBlurQuad.render(renderer);
   }
   if(baseFinish&&!illustrated){renderer.setRenderTarget(halo);glowQuad.render(renderer);}
   renderer.setRenderTarget(target);quad.render(renderer);
  }finally{renderer.setRenderTarget(target);renderer.autoClear=clear;}
 },dispose(){texture?.dispose();halo?.dispose();sceneBuffer?.depthTexture?.dispose();sceneBuffer?.dispose();blurHorizontal?.dispose();defocused?.dispose();depthBlurQuad.dispose();depthBlurMaterial.dispose();glowQuad.dispose();glowMaterial.dispose();quad.dispose();material.dispose();}};
}
