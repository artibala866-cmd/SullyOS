// Editor-only. Copy this file to Assets/Editor in a Unity project.
// Samples Humanoid clips on a VALID Humanoid Avatar. No SullyOS runtime changes.
// Unity 2021.3+; requires importing the original .unitypackage separately.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

public sealed class AmaamaSullyMotionExporter : EditorWindow
{
    private GameObject humanoidPrefab;
    private AnimationClip source;
    private AnimationClip previous;
    private string motionId = "home-head-pat";
    private float startTime;
    private float endTime;
    private int rate = 30;
    private int animatedActor = 0;
    private bool mirrorX = true;

    private struct Joint
    {
        public string target;
        public HumanBodyBones source;
        public Joint(string t, HumanBodyBones s) { target = t; source = s; }
    }

    // SullyOS blankRig has its 'L' on +X. Unity's humanoid Left is on -X,
    // so swapping human left/right AND mirroring X is intentional.
    private static readonly Joint[] Map =
    {
        new Joint("hips", HumanBodyBones.Hips),
        new Joint("spine", HumanBodyBones.Spine),
        new Joint("chest", HumanBodyBones.Chest),
        new Joint("neck", HumanBodyBones.Neck),
        new Joint("head", HumanBodyBones.Head),
        new Joint("L_clavicle", HumanBodyBones.RightShoulder),
        new Joint("L_upperArm", HumanBodyBones.RightUpperArm),
        new Joint("L_forearm", HumanBodyBones.RightLowerArm),
        new Joint("L_hand", HumanBodyBones.RightHand),
        new Joint("R_clavicle", HumanBodyBones.LeftShoulder),
        new Joint("R_upperArm", HumanBodyBones.LeftUpperArm),
        new Joint("R_forearm", HumanBodyBones.LeftLowerArm),
        new Joint("R_hand", HumanBodyBones.LeftHand),
        new Joint("L_thigh", HumanBodyBones.RightUpperLeg),
        new Joint("L_shin", HumanBodyBones.RightLowerLeg),
        new Joint("L_foot", HumanBodyBones.RightFoot),
        new Joint("L_toe", HumanBodyBones.RightToes),
        new Joint("R_thigh", HumanBodyBones.LeftUpperLeg),
        new Joint("R_shin", HumanBodyBones.LeftLowerLeg),
        new Joint("R_foot", HumanBodyBones.LeftFoot),
        new Joint("R_toe", HumanBodyBones.LeftToes),
        new Joint("L_thumb", HumanBodyBones.RightThumbProximal),
        new Joint("L_thumb_tip", HumanBodyBones.RightThumbIntermediate),
        new Joint("L_index", HumanBodyBones.RightIndexProximal),
        new Joint("L_index_tip", HumanBodyBones.RightIndexIntermediate),
        new Joint("L_middle", HumanBodyBones.RightMiddleProximal),
        new Joint("L_middle_tip", HumanBodyBones.RightMiddleIntermediate),
        new Joint("L_ring", HumanBodyBones.RightRingProximal),
        new Joint("L_ring_tip", HumanBodyBones.RightRingIntermediate),
        new Joint("L_pinky", HumanBodyBones.RightLittleProximal),
        new Joint("L_pinky_tip", HumanBodyBones.RightLittleIntermediate),
        new Joint("R_thumb", HumanBodyBones.LeftThumbProximal),
        new Joint("R_thumb_tip", HumanBodyBones.LeftThumbIntermediate),
        new Joint("R_index", HumanBodyBones.LeftIndexProximal),
        new Joint("R_index_tip", HumanBodyBones.LeftIndexIntermediate),
        new Joint("R_middle", HumanBodyBones.LeftMiddleProximal),
        new Joint("R_middle_tip", HumanBodyBones.LeftMiddleIntermediate),
        new Joint("R_ring", HumanBodyBones.LeftRingProximal),
        new Joint("R_ring_tip", HumanBodyBones.LeftRingIntermediate),
        new Joint("R_pinky", HumanBodyBones.LeftLittleProximal),
        new Joint("R_pinky_tip", HumanBodyBones.LeftLittleIntermediate),
    };

    [MenuItem("Tools/SullyOS/Amaama Humanoid to JSON")]
    public static void ShowWindow() => GetWindow<AmaamaSullyMotionExporter>("Amaama → SullyOS");

    private void OnGUI()
    {
        EditorGUILayout.HelpBox(
            "Export only: no repository/game files are overwritten. A prefab/model with a valid Humanoid Avatar is required; the Amaama package contains clips, not a Humanoid model.",
            MessageType.Info);
        humanoidPrefab = (GameObject)EditorGUILayout.ObjectField("Humanoid prefab/model", humanoidPrefab, typeof(GameObject), true);
        source = (AnimationClip)EditorGUILayout.ObjectField("Source .anim", source, typeof(AnimationClip), false);
        if (source != previous) { previous = source; startTime = 0; endTime = source ? source.length : 0; }
        motionId = EditorGUILayout.TextField("SullyOS action ID", motionId);
        startTime = EditorGUILayout.FloatField("Source start (seconds)", startTime);
        endTime = EditorGUILayout.FloatField("Source end (seconds)", endTime);
        rate = EditorGUILayout.IntSlider("Samples per second", rate, 15, 60);
        animatedActor = EditorGUILayout.Popup("Performing role", animatedActor, new[] { "A (actor 0)", "B (actor 1)" });
        mirrorX = EditorGUILayout.Toggle("Match blankRig (mirror X)", mirrorX);
        EditorGUILayout.HelpBox(
            "Only the chosen actor gets baked bones. The other actor has a neutral placeholder; IK/response must be validated later. Do not commit third-party clips to a public repo without redistribution permission.",
            MessageType.Warning);
        if (GUILayout.Button("Bake JSON to local file"))
        {
            try { Export(); }
            catch (Exception e) { Debug.LogException(e); EditorUtility.DisplayDialog("Bake failed", e.Message, "OK"); }
        }
    }

    private static float Number(float x)
    {
        if (float.IsNaN(x) || float.IsInfinity(x))
            throw new InvalidDataException("Nonfinite Humanoid sample");
        return x;
    }

    private static void AppendNum(StringBuilder sb, float x) =>
        sb.Append(Number(x).ToString("R", CultureInfo.InvariantCulture));

    private static void AppendArray(StringBuilder sb, IList<float> values)
    {
        sb.Append('[');
        for (int i = 0; i < values.Count; i++)
        {
            if (i != 0) sb.Append(',');
            AppendNum(sb, values[i]);
        }
        sb.Append(']');
    }

    private static string BuildJson(string id, List<float> times,
        Dictionary<string, List<float>> baked, int role)
    {
        float duration = times[times.Count - 1];
        var sb = new StringBuilder(250000);
        sb.Append("{\"version\":1,\"id\":\"").Append(id).Append("\",\"duration\":");
        AppendNum(sb, duration);
        sb.Append(",\"actors\":[");
        for (int actor = 0; actor < 2; actor++)
        {
            if (actor > 0) sb.Append(',');
            sb.Append("{\"duration\":"); AppendNum(sb, duration);
            sb.Append(",\"times\":"); AppendArray(sb, times);
            sb.Append(",\"tracks\":{");
            if (actor == role)
            {
                int index = 0;
                foreach (var kv in baked.OrderBy(x => x.Key, StringComparer.Ordinal))
                {
                    if (index++ > 0) sb.Append(',');
                    sb.Append('"').Append(kv.Key).Append("\":");
                    AppendArray(sb, kv.Value);
                }
            }
            else
            {
                sb.Append("\"hips\":[");
                for (int i = 0; i < times.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append("0,0,0,1");
                }
                sb.Append(']');
            }
            sb.Append("},\"positions\":[");
            // These are LOCAL capture positions, not real-world room/root motion.
            // Never import RootT as a global root translation into existing scene.
            float z = actor == 0 ? -.36f : .36f;
            for (int i = 0; i < times.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append("0,1,"); AppendNum(sb, z);
            }
            sb.Append("],\"points\":{},\"hipHeight\":1}");
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private void Export()
    {
        if (source == null || humanoidPrefab == null)
            throw new InvalidOperationException("Choose both .anim and a Humanoid prefab/model.");
        if (startTime < 0 || endTime > source.length + .001f || endTime <= startTime)
            throw new InvalidOperationException("Invalid source trim window.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(motionId ?? "", @"^[a-z0-9][a-z0-9-]*$"))
            throw new InvalidOperationException("ID must contain only lowercase ASCII, digits or '-'.");
        var path = EditorUtility.SaveFilePanel("Bake SullyOS motion JSON", "", motionId + ".json", "json");
        if (string.IsNullOrEmpty(path)) return;

        GameObject clone = null;
        HumanPoseHandler handler = null;
        bool animationModeStarted = false;
        try
        {
            clone = Instantiate(humanoidPrefab);
            clone.name = "SullyBake_Temporary";
            clone.hideFlags = HideFlags.HideAndDontSave;
            var animator = clone.GetComponentInChildren<Animator>(true);
            if (animator == null || animator.avatar == null ||
                !animator.avatar.isHuman || !animator.avatar.isValid)
                throw new InvalidOperationException("Selected prefab lacks a valid Humanoid Avatar.");
            animator.enabled = true;
            animator.applyRootMotion = false;
            handler = new HumanPoseHandler(animator.avatar, animator.transform);

            // Zero human muscles is the neutral pose, not the source's first frame.
            // Using first frame as bind pose would erase the beginning of a gesture.
            var neutral = new HumanPose
            {
                bodyPosition = new Vector3(0, 1, 0),
                bodyRotation = Quaternion.identity,
                muscles = new float[HumanTrait.MuscleCount]
            };
            handler.SetHumanPose(ref neutral);
            var joints = Map
                .Select(j => new { joint = j, bone = animator.GetBoneTransform(j.source) })
                .Where(x => x.bone != null)
                .ToArray();
            var essentials = new[] { "hips", "spine", "head", "L_upperArm",
                "R_upperArm", "L_forearm", "R_forearm", "L_hand", "R_hand",
                "L_thigh", "R_thigh", "L_shin", "R_shin" };
            foreach (var required in essentials)
                if (!joints.Any(x => x.joint.target == required))
                    throw new InvalidOperationException("Humanoid Avatar misses required mapped bone " + required);

            // Capture LOCAL rest rotation and WORLD bind basis per bone. This
            // cancels importer-specific local bone axes before coordinate mirror.
            var bindLocal = joints.Select(x => x.bone.localRotation).ToArray();
            var bindWorld = joints.Select(x => x.bone.rotation).ToArray();
            int count = Mathf.Max(2, Mathf.CeilToInt((endTime - startTime) * rate) + 1);
            var times = new List<float>(count);
            var tracks = joints.ToDictionary(x => x.joint.target,
                x => new List<float>(count * 4), StringComparer.Ordinal);
            var last = new Dictionary<string, Quaternion>(StringComparer.Ordinal);
            AnimationMode.StartAnimationMode();
            animationModeStarted = true;
            float maxChange = 0;
            for (int frame = 0; frame < count; frame++)
            {
                float alpha = frame / (float)(count - 1);
                float t = Mathf.Lerp(startTime, endTime, alpha);
                AnimationMode.SampleAnimationClip(animator.gameObject, source, t);
                times.Add((endTime - startTime) * alpha);
                for (int j = 0; j < joints.Length; j++)
                {
                    var target = joints[j].joint.target;
                    // Convert neutral-relative local rotation into the neutral
                    // global coordinate frame before mapping to blankRig.
                    Quaternion delta = Quaternion.Inverse(bindLocal[j]) * joints[j].bone.localRotation;
                    Quaternion q = bindWorld[j] * delta * Quaternion.Inverse(bindWorld[j]);
                    if (mirrorX) q = new Quaternion(q.x, -q.y, -q.z, q.w);
                    q = Quaternion.Normalize(q);
                    if (last.TryGetValue(target, out Quaternion prev))
                    {
                        maxChange = Mathf.Max(maxChange, Quaternion.Angle(prev, q));
                        if (Quaternion.Dot(prev, q) < 0)
                            q = new Quaternion(-q.x, -q.y, -q.z, -q.w);
                    }
                    last[target] = q;
                    var arr = tracks[target];
                    arr.Add(Number(q.x)); arr.Add(Number(q.y));
                    arr.Add(Number(q.z)); arr.Add(Number(q.w));
                }
            }
            if (maxChange < .05f)
                throw new InvalidDataException("Animation did not change the rig. Check Humanoid Avatar and clip sampling.");
            if (maxChange > 90f)
                throw new InvalidDataException("Large per-frame rotation jump (" + maxChange.ToString("F1") + " deg). Rejecting bake.");
            var json = BuildJson(motionId, times, tracks, animatedActor);
            File.WriteAllText(path, json, new UTF8Encoding(false));
            Debug.Log("[SullyOS] Baked " + source.name + " to " + path +
                "; " + count + " frames, " + tracks.Count + " mapped bones, max delta " +
                maxChange.ToString("F1") + "°. Still needs Q-body/IK visual QA.");
            EditorUtility.DisplayDialog("Bake complete",
                "Wrote JSON locally (" + count + " frames). Validate with node before game integration; no existing game files were changed.", "OK");
        }
        finally
        {
            if (animationModeStarted) AnimationMode.StopAnimationMode();
            if (handler != null) handler.Dispose();
            if (clone != null) DestroyImmediate(clone);
        }
    }
}
