/**
 * Internal reuse taxonomy. This is deliberately independent of the eight
 * user-facing motion menu categories: one action can use several capabilities.
 * Registering a capability does NOT enable a new action or eagerly load data.
 */
export const motionCapabilities={
 singlePose:{label:'单人姿态与表情',existing:'selectedMotions.ts'},
 handContact:{label:'手掌接触',existing:'socialContact.ts'},
 bodyContact:{label:'身体接触',existing:'socialContact.ts'},
 armWrap:{label:'拥抱与手臂环绕',existing:'hugMotion.ts'},
 faceContact:{label:'头部与面部接触',existing:'headContactIK.ts'},
 seatTransition:{label:'坐姿与起身',existing:'../seatChange.js'},
 residentNavigation:{label:'行走与人物避让',existing:'../residentNavigation.js'},
 pairedSync:{label:'双人同步',existing:'selectedSocial.ts'},
 propInteraction:{label:'道具交互',existing:'socialProps.ts'},
 supportAndLift:{label:'托举与重心调整',existing:'intimacyMotion.ts'},
} as const;

export type MotionCapability=keyof typeof motionCapabilities;
export const motionCapabilityKeys=Object.keys(motionCapabilities) as MotionCapability[];
