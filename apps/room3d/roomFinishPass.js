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
  uniforms:{source:{value:null},halo:{value:null},glow:{value:.12},warmth:{value:0},detail:{value:0},finishOn:{value:1},pixel:{value:new T.Vector2()}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`varying vec2 vUv;uniform sampler2D source;uniform sampler2D halo;uniform float glow;uniform float warmth;
   uniform float detail;uniform float finishOn;uniform vec2 pixel;
   vec3 sceneColor(vec2 uv){return sRGBTransferEOTF(texture2D(source,clamp(uv,vec2(0.),vec2(1.)))).rgb;}
   void main(){
    vec3 c=sceneColor(vUv);float l=dot(c,vec3(.2126,.7152,.0722));
    // ReShade/CAS-inspired local contrast is optional and strictly post-render.
    // Never touch character shaders, authored textures, or original light/shadow values.
    // Shade smooth mid-tones gently, avoid white skin highlights and black outlines.
    if(detail>.001){
     vec3 near=(sceneColor(vUv+vec2(pixel.x,0.))+sceneColor(vUv-vec2(pixel.x,0.))
               +sceneColor(vUv+vec2(0.,pixel.y))+sceneColor(vUv-vec2(0.,pixel.y)))*.25;
     float weight=smoothstep(.045,.18,l)*(1.-smoothstep(.78,.98,l));
     vec3 micro=clamp(c-near,vec3(-.055),vec3(.055));
     c=max(c+micro*detail*weight,vec3(0.));
    }
    if(finishOn>.5){
     // Original finish math: unchanged, including all four time-of-day glow strengths.
     vec3 bloom=texture2D(halo,vUv).rgb;
     c=mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,1.04);c=(c-.18)*1.025+.18;
     c+=bloom*glow*(1.-clamp(c,0.,1.)) + vec3(.012,.005,0.)*warmth*smoothstep(.35,.85,l);
    }
    gl_FragColor=vec4(max(c,0.),1.);
    #include <colorspace_fragment>
   }`});
 const quad=new FullScreenQuad(material);
 const glowQuad=new FullScreenQuad(glowMaterial);
 return {render(phase,{baseFinish=true,detail=0}={}){
  renderer.getDrawingBufferSize(size);
  if(width!==size.x||height!==size.y){texture?.dispose();halo?.dispose();width=size.x;height=size.y;texture=new T.FramebufferTexture(width,height);texture.colorSpace=T.NoColorSpace;texture.minFilter=texture.magFilter=T.LinearFilter;halo=new T.WebGLRenderTarget(Math.ceil(width/2),Math.ceil(height/2),{depthBuffer:false,stencilBuffer:false});material.uniforms.source.value=glowMaterial.uniforms.source.value=texture;material.uniforms.halo.value=halo.texture;}
  glowMaterial.uniforms.pixel.value.set(1/width,1/height);
  material.uniforms.pixel.value.set(1/width,1/height);
  material.uniforms.detail.value=T.MathUtils.clamp(Number(detail)||0,0,.7);
  material.uniforms.finishOn.value=baseFinish?1:0;
  material.uniforms.glow.value=baseFinish?(phase==='sunset'?.22:phase==='morning'?.14:phase==='night'?.12:.07):0;
  material.uniforms.warmth.value=baseFinish?(phase==='sunset'?1:phase==='night'?.45:0):0;
  renderer.copyFramebufferToTexture(texture);const clear=renderer.autoClear,target=renderer.getRenderTarget();renderer.autoClear=false;
  try{if(baseFinish){renderer.setRenderTarget(halo);glowQuad.render(renderer);}renderer.setRenderTarget(target);quad.render(renderer);}finally{renderer.setRenderTarget(target);renderer.autoClear=clear;}
 },dispose(){texture?.dispose();halo?.dispose();glowQuad.dispose();glowMaterial.dispose();quad.dispose();material.dispose();}};
}
