package app.hiunni.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** A no-display trampoline avoids creating a translucent shortcut window on ChromeOS. */
public final class ShortcutActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        startActivity(new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(LaunchPolicy.resolve(getIntent().getDataString())))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }
}
