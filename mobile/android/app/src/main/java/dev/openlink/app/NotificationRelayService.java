package dev.openlink.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Mirrors phone notifications to the PC and posts quick replies back.
 * The user must grant notification access once in Android settings.
 */
public class NotificationRelayService extends NotificationListenerService {

    private static final class Entry {
        String id;
        String app;
        String title;
        String text;
        long ts;
        PendingIntent replyIntent;
        RemoteInput[] remoteInputs;
        String resultKey;
    }

    private static final Map<String, Entry> RECENT = new LinkedHashMap<String, Entry>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Entry> eldest) {
            return size() > 24;
        }
    };

    private static NotificationRelayService instance;

    @Override
    public void onListenerConnected() {
        instance = this;
    }

    @Override
    public void onListenerDisconnected() {
        if (instance == this) instance = null;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        if (getPackageName().equals(sbn.getPackageName())) return;
        Notification notification = sbn.getNotification();
        Bundle extras = notification.extras;
        if (extras == null) return;

        String title = stringOf(extras.getCharSequence(Notification.EXTRA_TITLE));
        String text = stringOf(extras.getCharSequence(Notification.EXTRA_TEXT));
        if (TextUtils.isEmpty(title) && TextUtils.isEmpty(text)) return;

        Entry entry = new Entry();
        entry.id = sbn.getKey();
        entry.app = appLabel(sbn.getPackageName());
        entry.title = title;
        entry.text = text;
        entry.ts = sbn.getPostTime();

        if (notification.actions != null) {
            for (Notification.Action action : notification.actions) {
                RemoteInput[] inputs = action.getRemoteInputs();
                if (inputs == null || inputs.length == 0) continue;
                for (RemoteInput input : inputs) {
                    if (input.getAllowFreeFormInput()) {
                        entry.remoteInputs = new RemoteInput[] { input };
                        entry.resultKey = input.getResultKey();
                        entry.replyIntent = action.actionIntent;
                        break;
                    }
                }
                if (entry.replyIntent != null) break;
            }
        }
        synchronized (RECENT) {
            RECENT.put(entry.id, entry);
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        if (sbn == null) return;
        synchronized (RECENT) {
            RECENT.remove(sbn.getKey());
        }
    }

    private String stringOf(CharSequence value) {
        return value == null ? "" : value.toString();
    }

    private String appLabel(String pkg) {
        try {
            return getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString();
        } catch (Exception err) {
            return pkg;
        }
    }

    public static boolean hasAccess(Context context) {
        try {
            String flat = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
            if (flat == null) return false;
            ComponentName me = new ComponentName(context, NotificationRelayService.class);
            return flat.contains(me.flattenToString()) || flat.contains(context.getPackageName());
        } catch (Exception err) {
            return false;
        }
    }

    public static JSONArray asJson() {
        JSONArray array = new JSONArray();
        synchronized (RECENT) {
            for (Entry entry : RECENT.values()) {
                try {
                    JSONObject json = new JSONObject();
                    json.put("id", entry.id);
                    json.put("app", entry.app);
                    json.put("title", entry.title);
                    json.put("text", entry.text);
                    json.put("ts", entry.ts);
                    json.put("canReply", entry.replyIntent != null);
                    array.put(json);
                } catch (Exception ignored) {
                    // skip malformed entry
                }
            }
        }
        return array;
    }

    public static boolean reply(Context context, String id, String text) {
        Entry entry;
        synchronized (RECENT) {
            entry = RECENT.get(id);
        }
        if (entry == null || entry.replyIntent == null || entry.resultKey == null) return false;
        try {
            Bundle results = new Bundle();
            results.putCharSequence(entry.resultKey, text);
            Intent intent = new Intent();
            RemoteInput.addResultsToIntent(entry.remoteInputs, intent, results);
            if (Build.VERSION.SDK_INT >= 26) {
                RemoteInput.setResultsSource(intent, RemoteInput.SOURCE_FREE_FORM_INPUT);
            }
            entry.replyIntent.send(context, 0, intent);
            synchronized (RECENT) {
                RECENT.remove(id);
            }
            return true;
        } catch (PendingIntent.CanceledException err) {
            return false;
        }
    }
}
