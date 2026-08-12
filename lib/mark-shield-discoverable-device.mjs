/**
 * Shared markShield discoverable-device allowlist (agent copy).
 * Keep MARK_SHIELD_DISCOVERABLE_DEVICE_RE_SOURCE identical to
 * src/domain/mqtt/mark-shield-discoverable-device.ts
 */

export const MARK_SHIELD_DISCOVERABLE_DEVICE_RE_SOURCE =
  "mr6c|mr6cu|mr6cv|mr6lv|mrps6|mdm|mrm2|mrm|mrwm|mrwl|mr3|mr12|mr11|wb[-_]?led|ampled|mali|mao4|maod|dimmer|mdali|dali|mdr8|mcm8|mcm16|mcm24|wd14|mdi|^wb-gpio$|gpio|m1w2|msw|mwac|map3|map12|map6|^wb-map|mai6|mir|mio|ups|mgev";

export const MARK_SHIELD_DISCOVERABLE_DEVICE_RE = new RegExp(
  MARK_SHIELD_DISCOVERABLE_DEVICE_RE_SOURCE,
  "i",
);

export function isMarkShieldDiscoverableDeviceKey(deviceTopicKey) {
  return MARK_SHIELD_DISCOVERABLE_DEVICE_RE.test(String(deviceTopicKey ?? ""));
}
