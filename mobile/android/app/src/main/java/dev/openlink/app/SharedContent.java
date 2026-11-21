package dev.openlink.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.database.Cursor;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/** Staging area for content other apps share into OpenLink. */
public final class SharedContent {

    public static String text = "";
    public static String url = "";
    private static final JSONArray ITEMS = new JSONArray();

    private SharedContent() {}

    public static synchronized void capture(Context context, Intent intent) {
        clear();
        CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (shared != null) {
            String value = shared.toString().trim();
            if (value.matches("(?i)^https?://\\S+$")) url = value;
            else text = value;
        }
        ArrayList<Uri> uris = new ArrayList<>();
        Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (single != null) uris.add(single);
        ArrayList<Uri> multiple = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (multiple != null) uris.addAll(multiple);

        for (Uri uri : uris) {
            try {
                String name = "shared-file";
                long size = 0;
                try (Cursor cursor = context.getContentResolver().query(uri, null, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                        if (nameIndex >= 0) name = cursor.getString(nameIndex);
                        if (sizeIndex >= 0) size = cursor.getLong(sizeIndex);
                    }
                }
                String mime = context.getContentResolver().getType(uri);
                File dir = new File(context.getCacheDir(), "incoming");
                if (!dir.exists()) dir.mkdirs();
                File target = new File(dir, System.currentTimeMillis() + "-" + name.replaceAll("[^A-Za-z0-9._-]", "_"));
                try (InputStream in = context.getContentResolver().openInputStream(uri);
                     FileOutputStream out = new FileOutputStream(target)) {
                    if (in == null) continue;
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
                }
                JSONObject item = new JSONObject();
                item.put("name", name);
                item.put("mime", mime == null ? "application/octet-stream" : mime);
                item.put("size", size > 0 ? size : target.length());
                item.put("path", target.getAbsolutePath());
                ITEMS.put(item);
            } catch (Exception ignored) {
                // A single unreadable URI must not drop the rest of the share.
            }
        }
    }

    public static synchronized JSONArray getJson(Context context) {
        return ITEMS;
    }

    public static synchronized void clear() {
        text = "";
        url = "";
        while (ITEMS.length() > 0) ITEMS.remove(0);
    }
}
