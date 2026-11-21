package dev.openlink.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.fragment.app.FragmentActivity;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.List;
import java.util.concurrent.Executor;

/**
 * Native surface for OpenLink: hardware-backed identity, BiometricPrompt,
 * MediaStore access, share-target intake and encrypted credential storage.
 *
 * The identity key never leaves the Android Keystore; only public keys and
 * ECDSA signatures cross the bridge.
 */
@CapacitorPlugin(
    name = "OpenLinkNative",
    permissions = {
        @Permission(alias = "images", strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
    }
)
public class OpenLinkPlugin extends Plugin {

    private static final String KEY_ALIAS = "openlink_identity";
    private static final String PREFS = "openlink_secure";
    private static final int MAX_PHOTO_BYTES = 6 * 1024 * 1024;

    /* ------------------------------------------------------------ identity */

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("id", deviceId());
        result.put("name", Build.MODEL == null ? "Android" : Build.MODEL);
        result.put("model", Build.MANUFACTURER + " " + Build.MODEL);
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("android", Build.VERSION.RELEASE);
        result.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    private String deviceId() {
        String id = getContext().getSharedPreferences("openlink", Context.MODE_PRIVATE)
            .getString("device_id", null);
        if (id == null) {
            id = "android-" + (Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID) == null
                ? Long.toHexString(System.currentTimeMillis())
                : Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID));
            getContext().getSharedPreferences("openlink", Context.MODE_PRIVATE).edit().putString("device_id", id).apply();
        }
        return id;
    }

    private KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build();
            generator.initialize(spec);
            generator.generateKeyPair();
        }
        return ks;
    }

    @PluginMethod
    public void ensureIdentity(PluginCall call) {
        try {
            KeyStore ks = keyStore();
            java.security.cert.Certificate cert = ks.getCertificate(KEY_ALIAS);
            String spki = Base64.encodeToString(cert.getPublicKey().getEncoded(), Base64.NO_WRAP);
            JSObject result = new JSObject();
            result.put("publicKey", spki);
            call.resolve(result);
        } catch (Exception err) {
            call.reject("keystore unavailable: " + err.getMessage());
        }
    }

    @PluginMethod
    public void sign(PluginCall call) {
        String value = call.getString("value", "");
        boolean biometric = Boolean.TRUE.equals(call.getBoolean("biometric", false));
        String reason = call.getString("reason", "Confirm it is you");
        if (value.isEmpty()) {
            call.reject("missing value");
            return;
        }
        if (!biometric) {
            signNow(call, value);
            return;
        }
        FragmentActivity activity = (FragmentActivity) getActivity();
        if (activity == null) {
            signNow(call, value);
            return;
        }
        Executor executor = ContextCompat.getMainExecutor(activity);
        BiometricPrompt prompt = new BiometricPrompt(activity, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                signNow(call, value);
            }

            @Override
            public void onAuthenticationError(int code, CharSequence message) {
                call.reject("biometric: " + message);
            }
        });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("OpenLink")
            .setSubtitle(reason)
            .setNegativeButtonText("Cancel")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK)
            .build();
        activity.runOnUiThread(() -> prompt.authenticate(info));
    }

    private void signNow(PluginCall call, String value) {
        try {
            KeyStore ks = keyStore();
            PrivateKey key = (PrivateKey) ks.getKey(KEY_ALIAS, null);
            Signature signature = Signature.getInstance("SHA256withECDSA");
            signature.initSign(key);
            signature.update(value.getBytes("UTF-8"));
            byte[] out = signature.sign();
            JSObject result = new JSObject();
            result.put("signature", Base64.encodeToString(out, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception err) {
            call.reject("sign failed: " + err.getMessage());
        }
    }

    @PluginMethod
    public void biometricAvailable(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        int status = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject result = new JSObject();
        result.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        result.put("enrolled", status == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(result);
    }

    /* ------------------------------------------------------------ QR scan */

    @PluginMethod
    public void scanQr(PluginCall call) {
        if (getActivity() == null) {
            call.reject("no activity");
            return;
        }
        Intent intent = new Intent(getContext(), QrScanActivity.class);
        startActivityForResult(call, intent, "scanResult");
    }

    @ActivityCallback
    private void scanResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("cancelled");
            return;
        }
        String value = result.getData().getStringExtra("value");
        JSObject out = new JSObject();
        out.put("value", value == null ? "" : value);
        call.resolve(out);
    }

    /* -------------------------------------------------------- keep awake */

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (enabled) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
        call.resolve();
    }

    /* ------------------------------------------------------------- photos */

    @PluginMethod
    public void getRecentPhotos(PluginCall call) {
        if (!hasImagesPermission()) {
            requestPermissionForAlias("images", call, "photosPermission");
            return;
        }
        readPhotos(call);
    }

    @PermissionCallback
    private void photosPermission(PluginCall call) {
        if (hasImagesPermission()) readPhotos(call);
        else {
            JSObject out = new JSObject();
            out.put("photos", new JSArray());
            out.put("reason", "permission");
            call.resolve(out);
        }
    }

    private boolean hasImagesPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return getContext().checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED;
        }
        return getContext().checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void readPhotos(PluginCall call) {
        long since = call.getLong("since", 0L) == null ? 0L : call.getLong("since", 0L);
        int limit = call.getInt("limit", 5) == null ? 5 : Math.min(10, call.getInt("limit", 5));
        JSArray photos = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = { MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.MIME_TYPE, MediaStore.Images.Media.SIZE, MediaStore.Images.Media.DATE_ADDED };
        String selection = since > 0 ? MediaStore.Images.Media.DATE_ADDED + " > ?" : null;
        String[] args = since > 0 ? new String[] { String.valueOf(since / 1000L) } : null;
        try (Cursor cursor = resolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, selection, args, MediaStore.Images.Media.DATE_ADDED + " DESC")) {
            if (cursor != null) {
                while (cursor.moveToNext() && photos.length() < limit) {
                    long id = cursor.getLong(0);
                    String name = cursor.getString(1);
                    String mime = cursor.getString(2);
                    long size = cursor.getLong(3);
                    long added = cursor.getLong(4) * 1000L;
                    if (size <= 0 || size > MAX_PHOTO_BYTES) continue;
                    Uri uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, String.valueOf(id));
                    byte[] data = readAll(resolver, uri, MAX_PHOTO_BYTES);
                    if (data == null) continue;
                    JSObject photo = new JSObject();
                    photo.put("id", String.valueOf(id));
                    photo.put("name", name == null ? "photo.jpg" : name);
                    photo.put("mime", mime == null ? "image/jpeg" : mime);
                    photo.put("size", size);
                    photo.put("takenAt", added);
                    photo.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
                    photos.put(photo);
                }
            }
        } catch (SecurityException err) {
            JSObject out = new JSObject();
            out.put("photos", new JSArray());
            out.put("reason", "permission");
            call.resolve(out);
            return;
        } catch (Exception err) {
            call.reject("photos: " + err.getMessage());
            return;
        }
        JSObject out = new JSObject();
        out.put("photos", photos);
        call.resolve(out);
    }

    private byte[] readAll(ContentResolver resolver, Uri uri, int max) {
        try (InputStream in = resolver.openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            int total = 0;
            while ((read = in.read(buffer)) > 0) {
                total += read;
                if (total > max) return null;
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        } catch (Exception err) {
            return null;
        }
    }

    /* -------------------------------------------------------- save / share */

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "openlink-file");
        String base64 = call.getString("base64", "");
        String mime = call.getString("mime", "application/octet-stream");
        String kind = call.getString("kind", "download");
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            Uri uri;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver resolver = getContext().getContentResolver();
                Uri collection = "image".equals(kind)
                    ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                uri = resolver.insert(collection, values);
                if (uri == null) throw new Exception("MediaStore rejected the file");
                try (java.io.OutputStream out = resolver.openOutputStream(uri)) {
                    out.write(data);
                }
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "OpenLink");
                if (!dir.exists()) dir.mkdirs();
                File file = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(data);
                }
                uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            }
            JSObject out = new JSObject();
            out.put("uri", uri.toString());
            call.resolve(out);
        } catch (Exception err) {
            call.reject("save failed: " + err.getMessage());
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "openlink-file");
        String base64 = call.getString("base64", "");
        String mime = call.getString("mime", "application/octet-stream");
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists()) dir.mkdirs();
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(Base64.decode(base64, Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType(mime);
            share.putExtra(Intent.EXTRA_STREAM, uri);
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(share, "Share via OpenLink"));
            call.resolve();
        } catch (Exception err) {
            call.reject("share failed: " + err.getMessage());
        }
    }

    /* ------------------------------------------------------ notifications */

    @PluginMethod
    public void notifications(PluginCall call) {
        JSObject out = new JSObject();
        out.put("access", NotificationRelayService.hasAccess(getContext()));
        out.put("notifications", NotificationRelayService.asJson());
        call.resolve(out);
    }

    @PluginMethod
    public void replyNotification(PluginCall call) {
        String id = call.getString("id", "");
        String text = call.getString("text", "");
        boolean ok = NotificationRelayService.reply(getContext(), id, text);
        JSObject out = new JSObject();
        out.put("ok", ok);
        call.resolve(out);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception err) {
            Intent fallback = new Intent(Settings.ACTION_SETTINGS);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
        call.resolve();
    }

    /* ------------------------------------------------------- share target */

    @PluginMethod
    public void getSharedContent(PluginCall call) {
        JSObject out = new JSObject();
        out.put("items", SharedContent.getJson(getContext()));
        out.put("text", SharedContent.text);
        out.put("url", SharedContent.url);
        call.resolve(out);
    }

    @PluginMethod
    public void clearShared(PluginCall call) {
        SharedContent.clear();
        call.resolve();
    }

    /* ---------------------------------------------------------- secure store */

    private SharedPreferences securePrefs() {
        try {
            MasterKey key = new MasterKey.Builder(getContext())
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
            return EncryptedSharedPreferences.create(
                getContext(),
                PREFS,
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception err) {
            return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        }
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value", "");
        if (key.isEmpty()) {
            call.reject("missing key");
            return;
        }
        securePrefs().edit().putString(key, value).apply();
        call.resolve();
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String key = call.getString("key", "");
        JSObject out = new JSObject();
        out.put("value", securePrefs().getString(key, ""));
        call.resolve(out);
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String key = call.getString("key", "");
        securePrefs().edit().remove(key).apply();
        call.resolve();
    }

    /* --------------------------------------------------------------- misc */

    @PluginMethod
    public void usbConnected(PluginCall call) {
        Intent battery = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        boolean plugged = battery != null && battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        JSObject out = new JSObject();
        out.put("connected", plugged);
        call.resolve(out);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("missing url");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void setChrome(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                int flags = activity.getWindow().getDecorView().getSystemUiVisibility();
                if (dark) flags &= ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                else flags |= android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                activity.getWindow().getDecorView().setSystemUiVisibility(flags);
            });
        }
        call.resolve();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (getActivity() == null) return;
        // Nothing to do automatically; kept for future foreground sync.
    }
}
