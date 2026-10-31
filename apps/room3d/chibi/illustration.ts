import * as T from 'three';
import {getCharacterStyle,type CharacterStyle} from './characterStyle';

// A single material pass: retain painted features, cutout hair, skinning and
// garment colours, but replace physical highlights with two painted tones.
// Standalone previews use a fixed illustration light; homes bind their shared
// lighting uniforms and receive the room shadows in the existing material pass.
const originals = new WeakMap<T.MeshStandardMaterial, {
  compile: T.MeshStandardMaterial['onBeforeCompile'];
  cache: T.MeshStandardMaterial['customProgramCacheKey'];
  toneMapped: boolean;
  style: CharacterStyle;
}>();
type RoomLightUniforms = {roomShadeTint:{value:T.Color};roomSunTint:{value:T.Color};roomBrightness:{value:number};roomSunContrast:{value:number};roomShadeSoftness?:{value:number}};
const roomTints = new WeakMap<T.MeshStandardMaterial, {value:T.Color}>();
const roomLights = new WeakMap<T.MeshStandardMaterial, {enabled:{value:number}; uniforms:RoomLightUniforms}>();

export function setCharacterRoomLighting(root:T.Object3D,uniforms:RoomLightUniforms){
 root.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  object.receiveShadow=true;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(!(material instanceof T.MeshStandardMaterial))continue;
   const room=roomLights.get(material);if(!room||room.uniforms===uniforms)continue;
   room.enabled.value=1;room.uniforms=uniforms;material.needsUpdate=true;
  }
 });
}

// Keep faces legible while giving all residents the same room colour cast.
// Standalone avatar previews keep a neutral tint.
export function setCharacterRoomTint(root:T.Object3D,color:string){
 root.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(!(material instanceof T.MeshStandardMaterial))continue;
   const tint=roomTints.get(material);if(tint)tint.value.set(color);
  }
 });
}

export function setCharacterIllustration(root:T.Object3D, enabled=true, style=getCharacterStyle()) {
  const seen = new Set<T.Material>();
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial) || seen.has(material)) continue;
      seen.add(material);
      const original = originals.get(material);
      if (!enabled) {
        if (!original) continue;
        material.onBeforeCompile = original.compile;
        material.customProgramCacheKey = original.cache;
        material.toneMapped = original.toneMapped;
        originals.delete(material);
        roomTints.delete(material);
        roomLights.delete(material);
      } else {
        if (original?.style===style) continue;
        const saved = original??{compile:material.onBeforeCompile, cache:material.customProgramCacheKey, toneMapped:material.toneMapped,style};
        material.onBeforeCompile=saved.compile;
        material.customProgramCacheKey=saved.cache;
        const cacheKey = material.customProgramCacheKey();
        const face=!!material.userData.illustrationFace;
        const skin=!face&&material.userData.illustrationSkin===true;
        // An already-painted face canvas can also contain clothing. Never classify
        // its entire atlas as exposed skin, and never infer material from colour.
        // Only explicit surface metadata may opt into a non-fabric response.
        // Outfit colour is not a reliable material classifier.
        const surface=material.userData.illustrationSurface;
        const leather=surface==='leather';
        const metal=surface==='metal';
        const hair=!!material.userData.illustrationHair || /hair/.test(object.name);
        originals.set(material,{...saved,style});
        const roomTint=roomTints.get(material)??{value:new T.Color('#ffffff')};roomTints.set(material,roomTint);
        const room=roomLights.get(material)??{enabled:{value:0},uniforms:{roomShadeTint:{value:new T.Color('#ffffff')},roomSunTint:{value:new T.Color('#ffffff')},roomBrightness:{value:1},roomSunContrast:{value:0}}};roomLights.set(material,room);
        material.toneMapped = false;
        material.onBeforeCompile = (shader,renderer) => {
          saved.compile.call(material,shader,renderer);
          // Only the opt-in illustrated look needs the following mesh-local axis.
          // Hair's parent is the existing animated head bone, so this follows nods
          // and turns without changing any hair geometry, normals, UV or textures.
          if(style==='illustrated'&&hair){
            const anchor='#include <begin_vertex>';
            if(!shader.vertexShader.includes(anchor))throw new Error('Missing hair shader vertex anchor');
            shader.vertexShader='varying vec3 inkLocalStrandView;\n'+shader.vertexShader.replace(
              anchor, anchor+'\ninkLocalStrandView=normalize(mat3(modelViewMatrix)*vec3(0.,1.,0.));',
            );
            shader.fragmentShader='varying vec3 inkLocalStrandView;\n'+shader.fragmentShader;
          }
          shader.uniforms.characterRoomTint=roomTint;
          shader.uniforms.characterRoomEnabled=room.enabled;
          Object.assign(shader.uniforms,room.uniforms);
          shader.fragmentShader='uniform vec3 characterRoomTint;\nuniform float characterRoomEnabled;\nuniform vec3 roomShadeTint;\nuniform vec3 roomSunTint;\nuniform float roomBrightness;\nuniform float roomSunContrast;\n'+shader.fragmentShader;
          if(style!=='legacy'){
            shader.uniforms.roomShadeSoftness=(room.uniforms as RoomLightUniforms).roomShadeSoftness??{value:0};
            shader.fragmentShader='uniform float roomShadeSoftness;\n'+shader.fragmentShader;
          }
          if(style!=='legacy')shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
          shader.fragmentShader = shader.fragmentShader.replace(
            'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
            style==='legacy'?`
            vec3 inkLight = normalize(mat3(viewMatrix) * vec3(-0.45, 0.8, 0.65));
            float inkFacing = dot(normal, inkLight);
            float inkEdge = max(fwidth(inkFacing) * 1.5, 0.012);
            float inkLit = smoothstep(0.12 - inkEdge, 0.12 + inkEdge, inkFacing);
            float inkShade = mix(${material.userData.illustrationFace ? '0.90' : '0.70'}, 1.0, inkLit);
            vec3 inkTint = mix(vec3(0.96, 0.97, 1.0), vec3(1.0), inkLit);
            vec3 inkPreview = diffuseColor.rgb * inkShade * inkTint * characterRoomTint;
            vec3 inkWeights = vec3(.2126,.7152,.0722);
            float inkBase = max(dot(diffuseColor.rgb,inkWeights),.001);
            float inkEnergy = dot(totalDiffuse,inkWeights)/inkBase;
            // directDiffuse includes window occlusion and the actual light direction.
            float inkDirect = dot(reflectedLight.directDiffuse,inkWeights)/inkBase;
            float inkSun = smoothstep(.18,.85,inkDirect);
            float inkRoomShade = mix(${material.userData.illustrationFace ? '.84' : '.68'},1.0,smoothstep(.18,.82,inkEnergy));
            inkRoomShade += inkSun * mix(.12,.38,roomSunContrast);
            vec3 inkRoomTint = mix(roomShadeTint,roomSunTint,inkSun);
            vec3 inkRoom = diffuseColor.rgb * inkRoomShade * inkRoomTint * roomBrightness;
            vec3 outgoingLight = mix(inkPreview,inkRoom,characterRoomEnabled);
            `:`
            vec3 inkLight = normalize(mat3(viewMatrix) * vec3(-0.45, 0.8, 0.65));
            #if NUM_DIR_LIGHTS > 0
              if(characterRoomEnabled > .5) inkLight = directionalLights[0].direction;
            #endif
            float inkFacing = dot(normal, inkLight);
            // Separate the authored shade boundary from ambient intensity.
            float inkSoftness = clamp(roomShadeSoftness*characterRoomEnabled,0.,1.);
            float inkFeather = max(fwidth(inkFacing)*1.5, ${face ? '.24' : '.13'})*mix(1.,1.4,inkSoftness);
            float inkLit = smoothstep(-inkFeather,inkFeather,inkFacing + ${face ? '.23' : hair ? '-.08' : '-.20'});
            float inkShadow = mix(1.,getShadowMask(),characterRoomEnabled);
            inkLit *= mix(${face ? '.62' : '.20'},1.,inkShadow);
            vec3 inkShadeFactor = ${face ? 'vec3(.89,.82,.79)' : hair ? 'vec3(.62,.53,.72)' : 'vec3(.63,.64,.78)'};
            // Neutralise only the lighting tint, keeping dyed clothes and hair intact.
            inkShadeFactor = mix(inkShadeFactor,vec3(dot(inkShadeFactor,vec3(.2126,.7152,.0722))),inkSoftness)*mix(1.,1.08,inkSoftness);
            vec3 inkShadeColor = diffuseColor.rgb * inkShadeFactor;
            vec3 inkShadeTint = mix(vec3(1.),roomShadeTint,characterRoomEnabled*.72);
            vec3 inkLitTint = mix(characterRoomTint,roomSunTint,characterRoomEnabled);
            float inkBrightness = mix(1.,roomBrightness,characterRoomEnabled);
            float inkForm = .90 + .10*smoothstep(-.1,.85,inkFacing);
            vec3 inkColor = mix(inkShadeColor*inkShadeTint,diffuseColor.rgb*.96*inkForm*inkLitTint,inkLit)*inkBrightness;
            ${style==='illustrated' ? `// Illustration-only material pass: three intentionally distinct
            // painted light bands driven by the ORIGINAL room light and shadow mask.
            // No extra lights, textures, geometry, passes, or modifications to modern/legacy.
            float inkToonN = inkFacing + ${face ? '.17' : skin ? '.13' : hair ? '-.04' : '-.08'};
            float inkToonAA = max(fwidth(inkToonN)*1.10,.018);
            float inkToonHalf = smoothstep(.04-inkToonAA,.04+inkToonAA,inkToonN);
            float inkToonKey = smoothstep(.53-inkToonAA,.53+inkToonAA,inkToonN);
            float inkCast = mix(1.,getShadowMask(),characterRoomEnabled);
            float inkToonCast = smoothstep(.24,.76,inkCast);
            float inkBandValue = ${face ? '.48' : skin ? '.42' : hair ? '.38' : '.37'}
              + ${face ? '.17' : skin ? '.20' : hair ? '.21' : '.20'} * inkToonHalf
              + ${face ? '.25' : skin ? '.29' : hair ? '.30' : '.31'} * inkToonKey;
            inkBandValue *= mix(${face || skin ? '.74' : '.66'},1.,inkToonCast);
            // Keep every original complexion/dye: multiply the painted texel,
            // never paint over the facial expression or replace the authored albedo.
            vec3 inkPaletteShade = ${face || skin ? 'vec3(.92,.77,.73)' : hair ? 'vec3(.74,.77,.90)' : 'vec3(.76,.78,.88)'};
            vec3 inkToonShadeTint = mix(vec3(1.),roomShadeTint,characterRoomEnabled*.65);
            vec3 inkToonLightTint = mix(characterRoomTint,roomSunTint,characterRoomEnabled);
            vec3 inkBandTint = mix(inkPaletteShade*inkToonShadeTint,inkToonLightTint,inkToonKey);
            inkColor = diffuseColor.rgb * inkBandTint * inkBandValue * inkBrightness;
            // A clean dark ink contour changes the *style*, but remains inside
            // this same surface shader and does not introduce outline meshes.
            float inkToonView = 1.-abs(dot(normal,normalize(vViewPosition)));
            float inkInkEdge=smoothstep(.32,.86,inkToonView);
            inkColor *= 1.-inkInkEdge*${face ? '.20' : skin ? '.27' : hair ? '.50' : '.42'};
            ${hair ? `// Local-head strand ribbons; glints are tinted, never metallic white.
            vec3 inkToonHalfVector = normalize(inkLight+normalize(vViewPosition));
            float inkStrand = abs(dot(normalize(inkLocalStrandView),inkToonHalfVector));
            float inkStrandFacing=clamp(dot(normal,inkToonHalfVector),0.,1.);
            float inkSatinWide=(1.-smoothstep(.16,.78,inkStrand))*smoothstep(.24,.80,inkStrandFacing);
            float inkSatinThin=(1.-smoothstep(.08,.28,inkStrand))*smoothstep(.72,.96,inkStrandFacing);
            vec3 inkSatinColor=sqrt(max(diffuseColor.rgb,vec3(0.)))*vec3(.58,.61,.66);
            inkColor += (1.-clamp(inkColor,0.,1.))*inkSatinColor*(inkSatinWide*.52+inkSatinThin*.11)*inkToonKey*inkToonCast;` : ''}
            ` : ''}
            vec3 inkView = normalize(vViewPosition);
            float inkFresnel = 1.-clamp(abs(dot(normal,inkView)),0.,1.);
            // Material-space edge shaping, not an extra outline mesh/pass.
            float inkContour = smoothstep(.62,.94,inkFresnel)*${face ? '.035' : '.16'}*(1.-inkLit*.5);
            inkColor *= 1.-inkContour;
            float inkRim = pow(inkFresnel,4.)*smoothstep(-.15,.65,inkFacing)*${style==='illustrated' ? face ? '.003' : hair ? '.010' : '.006' : face ? '.015' : hair ? '.055' : leather ? '.035' : metal ? '.045' : '.018'};
            ${leather || metal ? `// Restrained material-specific glint; no extra light, texture or pass.
            float inkSurfaceGlint = smoothstep(${metal ? '.88,.97' : '.62,.91'},dot(normal,normalize(inkLight+inkView)))*inkLit*${metal ? '.065' : '.028'};
            inkRim += inkSurfaceGlint;` : ''}
            ${hair && style!=='illustrated' ? `// A broad satin reflection follows the projected vertical strand axis.\n            // Avoid UV-derived tangents: projected/contour hair sheets do not share a reliable UV direction.\n            vec3 inkStrandAxis = normalize(mat3(viewMatrix) * vec3(0.,1.,0.));\n            vec3 inkHalf = normalize(inkLight+inkView);\n            float inkStrandAlignment = abs(dot(inkHalf,inkStrandAxis));\n            float inkHairBand = (1.-smoothstep(.26,.72,inkStrandAlignment))*smoothstep(.42,.92,dot(normal,inkHalf));\n            float inkHairHighlight = inkHairBand*inkLit*.024;\n            inkRim += inkHairHighlight;` : ''}
            vec3 outgoingLight = inkColor + (1.-clamp(inkColor,0.,1.))*inkRim*inkLitTint;
            `,
          );
        };
        material.customProgramCacheKey = () => cacheKey + '-character-illustration-v10-' + style + '-' + face + '-' + skin + '-' + hair + '-' + leather + '-' + metal;
      }
      material.userData.characterIllustration = enabled;
      material.needsUpdate = true;
    }
  });
}
