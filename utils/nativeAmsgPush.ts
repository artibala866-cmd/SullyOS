import {
  PushNotifications,
  type ActionPerformed,
  type PushNotificationSchema,
  type Token,
} from '@capacitor/push-notifications';
import { ActiveMsgClient, NATIVE_PUSH_TOKEN_STORAGE_KEY } from './activeMsgClient';
import { ingestNativeAmsgPayload, parseNativeAmsgPayload } from './nativeAmsgInbox';

let initialized = false;
let registeredForPush = false;
let initializing: Promise<void> | null = null;
const installed = {
  registration: false,
  registrationError: false,
  received: false,
  opened: false,
  resumeRecheck: false,
};

export const decodeNativeAmsgPayload = (
  notification: Pick<PushNotificationSchema, 'body' | 'data'>,
): Record<string, any> | null => {
  const raw = notification.data?.amsgPayload;
  if (typeof raw !== 'string') return null;
  const payload = parseNativeAmsgPayload(raw);
  if (!payload) return null;
  // The FCM data payload intentionally omits private text where possible;
  // only an explicit body marker authorizes using the notification text.
  const hasBody = notification.data?.amsgHasBody === '1';
  return {
    ...payload,
    message: hasBody ? String(notification.body || '') : '',
    ...(hasBody ? {} : { amsgNeedsOutboxRecovery: true }),
  };
};

/** Both native arrival and tap callbacks converge on the same receipt
 * ledger/IndexedDB transaction. No second "v1" message-ID list exists.
 */
const ingestNotification = async (notification: PushNotificationSchema): Promise<void> => {
  const payload = decodeNativeAmsgPayload(notification);
  if (!payload) return;
  await ingestNativeAmsgPayload(payload, String(notification.body || ''));
};

const onNotificationReceived = (notification: PushNotificationSchema) => {
  void ingestNotification(notification).catch(error =>
    console.warn('[ActiveMsg:native] 保存推送到收件箱失败，等待补收', error));
};

const onNotificationOpened = (action: ActionPerformed) => {
  const notification = action.notification;
  const charId = decodeNativeAmsgPayload(notification)?.metadata?.charId;
  void ingestNotification(notification).catch(error =>
    console.warn('[ActiveMsg:native] 点击通知时入库失败，仍可打开私聊等待补收', error))
    .finally(() => {
      if (typeof charId === 'string' && charId
        && typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('active-msg-open', { detail: { charId } }));
      }
    });
};

const onRegistrationError = (error: unknown) => {
  // The OS may report a failure asynchronously after register() returned.
  // Do not permanently treat this device as registered: try again when the
  // user next foregrounds the application.
  registeredForPush = false;
  console.warn('[ActiveMsg:native] FCM registration 失败，回前台后可重试', error);
};

const registerToken = async (token: Token) => {
  const value = token.value?.trim();
  if (!value) return;
  try {
    localStorage.setItem(NATIVE_PUSH_TOKEN_STORAGE_KEY, value);
  } catch (error) {
    console.warn('[ActiveMsg:native] 推送 token 本地缓存失败，尝试直接登记', error);
  }
  try {
    await ActiveMsgClient.registerNativePushToken(value);
  } catch (error) {
    console.info('[ActiveMsg:native] token 已保存，等待 Worker 连接后补登记', error);
  }
};

export const initNativeAmsgPush = async (): Promise<void> => {
  if (initialized && registeredForPush) return;
  if (initializing) return initializing;

  const task = (async () => {
    if (!initialized) {
      await PushNotifications.createChannel({
        id: 'amsg2', name: '主动消息', description: '角色主动消息与定时消息',
        importance: 5, visibility: 1, vibration: true,
      }).catch(() => undefined);
    }

    // A failure halfway through registration must remain retryable without
    // installing the already-successful listeners a second time.
    if (!installed.registration) {
      await PushNotifications.addListener('registration', registerToken);
      installed.registration = true;
    }
    if (!installed.registrationError) {
      await PushNotifications.addListener('registrationError', onRegistrationError);
      installed.registrationError = true;
    }
    if (!installed.received) {
      await PushNotifications.addListener('pushNotificationReceived', onNotificationReceived);
      installed.received = true;
    }
    if (!installed.opened) {
      await PushNotifications.addListener('pushNotificationActionPerformed', onNotificationOpened);
      installed.opened = true;
    }

    // Android permission can change in Settings while the WebView survives.
    // Recheck on foreground, not only on the first application bootstrap.
    if (!installed.resumeRecheck && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !registeredForPush) {
          void initNativeAmsgPush().catch(error =>
            console.warn('[ActiveMsg:native] 回前台重新登记推送失败', error));
        }
      });
      installed.resumeRecheck = true;
    }

    const current = await PushNotifications.checkPermissions();
    // Request permission only on first bootstrap. Rechecking when coming
    // back from Settings must not repeatedly pop the OS consent dialog.
    const permission = current.receive === 'prompt' && !initialized
      ? await PushNotifications.requestPermissions() : current;
    if (permission.receive === 'granted' && !registeredForPush) {
      await PushNotifications.register();
      registeredForPush = true;
    }
    // A denied permission may be granted later in Android Settings.
    // Recheck on another init call without installing duplicate listeners.
    initialized = true;
  })();
  initializing = task;
  try {
    await task;
  } finally {
    if (initializing === task) initializing = null;
  }
};
