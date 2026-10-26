# Amaama .anim → SullyOS bone track: isolated prototype

**Scope:** This folder implements an off-line Unity Editor converter plus a JSON validator. It does not install a second animation player or touch motion templates, IK solvers, navigation, shared timeline, seating or cleanup.

## Observed source assets

The uploaded AmaamaAnimation-v1.2-free.unitypackage contains:

| Clip | Duration | Unity samples/s | Curves |
| --- | ---: | ---: | ---: |
| nade-normal.anim | 41.033 s | 30 | 107 |
| hug.anim | 38.167 s | 60 | 130 |
| sleep-right.anim | 13.900 s | 60 | 130 |
| hiza-makura1.anim | 35.067 s | 60 | 130 |
| hoppe.anim | 56.167 s | 30 | 107 |

These are Unity Humanoid muscle curves, **not bone quaternion tracks**. No usable Humanoid character/Avatar is included in this package. A separate valid humanoid model/prefab is required for Unity to perform the muscle-to-bone bake.

The current game action home-head-pat lasts 7.8 seconds. Its JSON holds static placeholder hips rotations, while selectedSocial.ts deliberately plays idle and headPatMotion.ts performs custom hand/head contact corrections. Simply replacing the JSON does **not** replace its visual action.

## Offline procedure

1. Import the supplied unitypackage into a scratch Unity project (2021.3+/2022.3). Also import a clean T-posed Humanoid model/prefab configured with a valid Unity Humanoid Avatar. Keep the third-party animation files **out of GitHub** until their redistribution rights are known.
2. Copy the Editor/AmaamaSullyMotionExporter.cs script into that Unity project's Assets/Editor/ folder.
3. Open Tools → SullyOS → Amaama Humanoid to JSON. Set the Humanoid prefab and nade-normal clip, choose ID home-head-pat, performer A, and select a source-time window after previewing the original clip. Do not speed up 41 seconds into the old 7.8 seconds.
4. Export a local .json file outside the SullyOS checkout. It follows the existing SelectedClip / MotionTrack schema (two actors, same sample times, target bone quaternions).
5. Run both checks:
   node tools/unity/validate-amaama-motion.mjs --selftest
   node tools/unity/validate-amaama-motion.mjs /absolute/path/home-head-pat.json home-head-pat
6. Review generated tracks in Unity and on the actual large-head blankRig character before integration. If the sample has unnatural bone axis signs, restore/adjust the action-specific retarget before touching runtime data.

## Deliberate safety limitations

- The exporter maps only **one active Humanoid actor**. The other is a neutral placeholder and must continue using its existing response/IK. Amaama .anim does not encode two performers.
- The exporter does **not export RootT into game root positions**; roots remain static local capture offsets. Shared room navigation retains ownership. Pelvis vertical motion and furniture transitions need action-specific validation.
- The original Unity left/right are swapped and the X axis is mirrored to match blankRig.ts (L on +X). Palm normals, elbows and fingers still need visual checking.
- UpperChest and optional anatomical transforms may need additional bone combination; the prototype is not a complete human retargeter.
- For this head-pat action, applying baked rotations will require a **small action-specific** replacement path while preserving the existing contact IK, not a new global animation system.
- Do not wire hiza-makura1 to home-sofa-lap-pillow without seat, pelvis, head contact and end-sitting tests.
- The running environment has no Unity Editor. This source-only change has not been compiled or executed within Unity, and no real animation or in-game pose has been validated.

## Release gate

Before using any exported clip in gameplay: Unity Avatar sample succeeds; JSON validator passes; source and Q-body pose compare; left/right palms and shoulder motions fit; no large rotational discontinuities; both height orders work; stop/replay, nearby people, sofa occupancy and Android Chrome are checked. An unverified JSON clip must never silently replace the current animation.
