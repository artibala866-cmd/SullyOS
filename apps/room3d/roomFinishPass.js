import * as T from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// Keep the source/character edges at full resolution. Only the soft halo is
// sampled at half width/height (one quarter of the expensive 8-tap fragments).
export function createRoomFinishPass(renderer){
 let texture=null,halo=null,width=0,height=0;const size=new T.Vector2();
 const glowMaterial=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{source:{value:null},pixel:{value:new T.Vector2()}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`varying vec2 vUv;uniform sampler2D source;uniform vec2 pixel;
   vec3 bright(vec2 p){vec3 c=sRGBTransferEOTF(texture2D(source,p)).rgb;return c*smoothstep(.58,.94,max(c.r,max(c.g,c.b)));}
   void main(){vec3 halo=vec3(0.);for(int i=0;i<8;i++){float a=float(i)*.78539816;halo+=bright(vUv+vec2(cos(a),sin(a))*pixel*4.);}gl_FragColor=vec4(halo/8.,1.);}`});
 const material=new T.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
  uniforms:{source:{value:null},halo:{value:null},glow:{value:.12},warmth:{value:0},detail:{value:0},finishOn:{value:1},artStyle:{value:0},pixel:{value:new T.Vector2()}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`varying vec2 vUv;uniform sampler2D source;uniform sampler2D halo;uniform float glow;uniform float warmth;
   uniform float detail;uniform float finishOn;uniform float artStyle;uniform vec2 pixel;
   vec3 sceneColor(vec2 uv){return sRGBTransferEOTF(texture2D(source,clamp(uv,vec2(0.),vec2(1.)))).rgb;}
   void main(){
    vec3 c=sceneColor(vUv);float l=dot(c,vec3(.2126,.7152,.0722));
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
     vec3 inkGrade=mix(vec3(.900,.938,1.045),vec3(1.087,1.045,.976),plane);
     c*=inkGrade;
     float midWeight=smoothstep(.07,.27,inkLuma)*(1.-smoothstep(.78,.97,inkLuma));
     c+=vec3((inkLuma-.46)*.20)*midWeight;
     float paintLuma=dot(c,vec3(.2126,.7152,.0722));
     c+= (c-vec3(paintLuma))*.12*midWeight;
     c=max(c,vec3(0.));
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
     float outlineStrength=smoothstep(.17,.58,colourDiscontinuity);
     // Ink the boundary pixel itself, never an offset silhouette.
     // Keep light, detailed surfaces crisp without filling them with black.
     float inkWeight=outlineStrength*mix(.14,.32,smoothstep(.11,.78,paintLuma));
     c=mix(c,vec3(.050,.041,.050),inkWeight);
     // Static fine-grain, applied after the lens pass. It is deliberately
     // weakest over clean whites, near-blacks, pupils and dark linework.
     vec2 grainCell=floor(gl_FragCoord.xy*.82);
     float noise=fract(sin(dot(grainCell,vec2(12.9898,78.233)))*43758.5453)-.5;
     float grainMask=smoothstep(.045,.18,inkLuma)*(1.-smoothstep(.85,1.04,inkLuma));
     c+=vec3(noise)*.028*grainMask;
    }
    gl_FragColor=vec4(max(c,0.),1.);
    #include <colorspace_fragment>
   }`});
 const quad=new FullScreenQuad(material);
 const glowQuad=new FullScreenQuad(glowMaterial);
 return {render(phase,{baseFinish=true,detail=0,illustrated=false}={}){
  renderer.getDrawingBufferSize(size);
  if(width!==size.x||height!==size.y){texture?.dispose();halo?.dispose();width=size.x;height=size.y;texture=new T.FramebufferTexture(width,height);texture.colorSpace=T.NoColorSpace;texture.minFilter=texture.magFilter=T.LinearFilter;halo=new T.WebGLRenderTarget(Math.ceil(width/2),Math.ceil(height/2),{depthBuffer:false,stencilBuffer:false});material.uniforms.source.value=glowMaterial.uniforms.source.value=texture;material.uniforms.halo.value=halo.texture;}
  glowMaterial.uniforms.pixel.value.set(1/width,1/height);
  material.uniforms.pixel.value.set(1/width,1/height);
  material.uniforms.detail.value=T.MathUtils.clamp(Number(detail)||0,0,.7);
  material.uniforms.artStyle.value=illustrated?1:0;
  material.uniforms.finishOn.value=baseFinish?1:0;
  // The Comic preset enables edge ink, not an image-copy DOF or bloom halo.
  // Keep all original bloom settings for modern/legacy; ink mode has none.
  material.uniforms.glow.value=baseFinish&&!illustrated?(phase==='sunset'?.22:phase==='morning'?.14:phase==='night'?.12:.07):0;
  material.uniforms.warmth.value=baseFinish?(phase==='sunset'?1:phase==='night'?.45:0):0;
  renderer.copyFramebufferToTexture(texture);const clear=renderer.autoClear,target=renderer.getRenderTarget();renderer.autoClear=false;
  try{if(baseFinish&&!illustrated){renderer.setRenderTarget(halo);glowQuad.render(renderer);}renderer.setRenderTarget(target);quad.render(renderer);}finally{renderer.setRenderTarget(target);renderer.autoClear=clear;}
 },dispose(){texture?.dispose();halo?.dispose();glowQuad.dispose();glowMaterial.dispose();quad.dispose();material.dispose();}};
}
