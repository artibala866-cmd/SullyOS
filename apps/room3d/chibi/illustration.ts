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
        // Cutout hair needs an outline along its *painted alpha*, not a fake
        // Fresnel shadow across the entire flat sheet.
        const cutoutHair=hair&&!!material.map&&material.alphaTest>.01;
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
          if(style==='illustrated'&&cutoutHair){
            const image=material.map?.image as {width?:number;height?:number}|undefined;
            const width=Math.max(1,image?.width??1024),height=Math.max(1,image?.height??1024);
            shader.uniforms.inkHairTexel={value:new T.Vector2(1/width,1/height)};
            shader.fragmentShader='uniform vec2 inkHairTexel;\n'+shader.fragmentShader;
            const alphaAnchor='#include <alphatest_fragment>';
            if(!shader.fragmentShader.includes(alphaAnchor))throw new Error('Missing hair alphatest shader anchor');
            shader.fragmentShader=shader.fragmentShader.replace(alphaAnchor,`
              #include <alphatest_fragment>
              float inkCutoutEdge=0.;
              #ifdef USE_MAP
                vec2 inkDelta=inkHairTexel*1.15;
                float inkNeighbourAlpha=min(
                  min(texture2D(map,vMapUv+vec2(inkDelta.x,0.)).a,texture2D(map,vMapUv-vec2(inkDelta.x,0.)).a),
                  min(texture2D(map,vMapUv+vec2(0.,inkDelta.y)).a,texture2D(map,vMapUv-vec2(0.,inkDelta.y)).a)
                );
                inkCutoutEdge=(1.-smoothstep(.13,.78,inkNeighbourAlpha))*smoothstep(.19,.70,diffuseColor.a);
              #endif
            `);
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
            ${style==='illustrated' ? `// Airy chibi cel: preserve original paint and room lighting,
            // but shape a luminous soft illustration ramp instead of dark slabs.
            float inkToonN=inkFacing+${face ? '.18' : skin ? '.13' : hair ? '-.04' : '-.08'};
            float inkToonAA=max(fwidth(inkToonN)*2.0,.035);
            float inkHalfTone=smoothstep(-.32-inkToonAA,.14+inkToonAA,inkToonN);
            float inkBrightTone=smoothstep(.30-inkToonAA,.85+inkToonAA,inkToonN);
            float inkToonCast=smoothstep(.10,.90,mix(1.,getShadowMask(),characterRoomEnabled));
            float inkToonIntensity=${face ? '.83' : skin ? '.80' : hair ? '.76' : '.78'}
                 +${face ? '.14' : skin ? '.17' : hair ? '.19' : '.18'}*inkHalfTone
                 +${face ? '.085' : skin ? '.09' : hair ? '.10' : '.09'}*inkBrightTone;
            inkToonIntensity*=mix(${face || skin ? '.88' : '.85'},1.,inkToonCast);
            // Pastel shadows, not universal purple-grey. Leave dye/eyes as painted.
            vec3 inkPastelShadow=${face || skin ? 'vec3(.98,.91,.88)' : hair ? 'vec3(.86,.90,.97)' : 'vec3(.91,.93,.97)'};
            vec3 inkShadeLight=mix(inkPastelShadow,mix(vec3(1.),roomShadeTint,characterRoomEnabled*.55),inkHalfTone);
            vec3 inkWarmKey=mix(characterRoomTint,roomSunTint,characterRoomEnabled);
            vec3 inkIllustrationTint=mix(inkShadeLight,inkWarmKey,inkBrightTone*.72);
            inkColor=diffuseColor.rgb*inkIllustrationTint*inkToonIntensity*inkBrightness;
            // Painted bright-plane glow for pale hair/skin without bleaching
            // the black eye artwork, facial expressions or dark clothing.
            float inkPaintBrightness=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
            float inkPaintedHighlight=smoothstep(.15,.58,inkPaintBrightness)*inkBrightTone;
            inkColor+=(1.-clamp(inkColor,0.,1.))
               *${face || skin ? 'vec3(.065,.035,.028)' : hair ? 'vec3(.062,.075,.091)' : 'vec3(.026,.031,.041)'}
               *inkPaintedHighlight;
            // Thin colour-preserving drawn contour, not a thick black ring.
            float inkViewEdge=1.-clamp(abs(dot(normal,normalize(vViewPosition))),0.,1.);
            float inkFineOutline=smoothstep(.84,.975,inkViewEdge);
            inkColor*=1.-inkFineOutline*${face ? '.09' : skin ? '.12' : hair ? '.19' : '.16'};
            ${hair ? `// Broad tinted strand ribbon follows the animated head bone.
            vec3 inkHairHalf=normalize(inkLight+normalize(vViewPosition));
            float inkStrandAngle=abs(dot(normalize(inkLocalStrandView),inkHairHalf));
            float inkHairSurface=max(dot(normal,inkHairHalf),0.);
            float inkWideSatin=(1.-smoothstep(.17,.83,inkStrandAngle))*smoothstep(.20,.83,inkHairSurface);
            float inkFineSatin=(1.-smoothstep(.08,.34,inkStrandAngle))*smoothstep(.67,.96,inkHairSurface);
            vec3 inkHairPigment=sqrt(max(diffuseColor.rgb,vec3(0.)))*vec3(.45,.49,.55);
            inkColor+=(1.-clamp(inkColor,0.,1.))*inkHairPigment
                *(inkWideSatin*.38+inkFineSatin*.075)*inkHalfTone*inkToonCast;` : ''}
            ` : ''}
            vec3 inkView = normalize(vViewPosition);
            float inkFresnel = 1.-clamp(abs(dot(normal,inkView)),0.,1.);
            // Material-space edge shaping, not an extra outline mesh/pass.
            float inkContour = smoothstep(.62,.94,inkFresnel)*${style==='illustrated' ? face ? '.008' : hair ? '.035' : '.024' : face ? '.035' : '.16'}*(1.-inkLit*.5);
            inkColor *= 1.-inkContour;
            float inkRim = pow(inkFresnel,4.)*smoothstep(-.15,.65,inkFacing)*${style==='illustrated' ? face ? '.003' : hair ? '.010' : '.006' : face ? '.015' : hair ? '.055' : leather ? '.035' : metal ? '.045' : '.018'};
            ${leather || metal ? `// Restrained material-specific glint; no extra light, texture or pass.
            float inkSurfaceGlint = smoothstep(${metal ? '.88,.97' : '.62,.91'},dot(normal,normalize(inkLight+inkView)))*inkLit*${metal ? '.065' : '.028'};
            inkRim += inkSurfaceGlint;` : ''}
            ${hair && style!=='illustrated' ? `// A broad satin reflection follows the projected vertical strand axis.\n            // Avoid UV-derived tangents: projected/contour hair sheets do not share a reliable UV direction.\n            vec3 inkStrandAxis = normalize(mat3(viewMatrix) * vec3(0.,1.,0.));\n            vec3 inkHalf = normalize(inkLight+inkView);\n            float inkStrandAlignment = abs(dot(inkHalf,inkStrandAxis));\n            float inkHairBand = (1.-smoothstep(.26,.72,inkStrandAlignment))*smoothstep(.42,.92,dot(normal,inkHalf));\n            float inkHairHighlight = inkHairBand*inkLit*.024;\n            inkRim += inkHairHighlight;` : ''}
            vec3 outgoingLight = inkColor + (1.-clamp(inkColor,0.,1.))*inkRim*inkLitTint;
            ${style==='illustrated' ? `// One-pass 2D ink linework: a narrow dark outline at actual mesh
            // silhouettes. Keep all colour/lighting calculations above intact.
            float inkViewDot=abs(dot(normal,normalize(vViewPosition)));
            float inkLineAA=max(fwidth(inkViewDot)*1.10,.018);
            float inkMeshStroke=1.-smoothstep(.075,.18+inkLineAA,inkViewDot);
            float inkStroke=max(inkMeshStroke*.91,${cutoutHair ? 'inkCutoutEdge*.96' : '0.'});
            // Warm dark brown-black like a hand-inked anime cel, not a
            // grey Fresnel or a multiply-over-darkened material.
            vec3 inkLineColour=mix(vec3(.055,.047,.060),diffuseColor.rgb*.12,.18);
            outgoingLight=mix(outgoingLight,inkLineColour,clamp(inkStroke,0.,1.));` : ''}
            `,
          );
        };
        material.customProgramCacheKey = () => cacheKey + '-character-illustration-v13-' + style + '-' + face + '-' + skin + '-' + hair + '-' + leather + '-' + metal;
      }
      material.userData.characterIllustration = enabled;
      material.needsUpdate = true;
    }
  });
}
