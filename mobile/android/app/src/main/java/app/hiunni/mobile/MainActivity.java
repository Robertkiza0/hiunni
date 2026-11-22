package app.hiunni.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

import com.google.androidbrowserhelper.trusted.TwaLauncher;

import java.util.ArrayList;
import java.util.List;

/**
 * Starts the live site without depending on LauncherActivity's window bootstrap.
 *
 * Some Android builds can fail while that bootstrap prepares a translucent edge-to-edge window.
 * The launcher below keeps TWA support, but owns every failure path so a browser/provider problem
 * cannot turn into an app crash dialog.
 */
public final class MainActivity extends Activity {
    private TwaLauncher twaLauncher;
    private Uri launchUri;
    private boolean launchStarted;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        String incoming = getIntent() == null ? null : getIntent().getDataString();
        launchUri = Uri.parse(LaunchPolicy.resolve(incoming));
        launch();
    }

    private void launch() {
        if (launchStarted || isFinishing()) return;
        launchStarted = true;
        try {
            twaLauncher = new TwaLauncher(this);
            TrustedWebActivityIntentBuilder builder = new TrustedWebActivityIntentBuilder(launchUri);
            twaLauncher.launch(builder, null, null, this::finish,
                (context, ignoredBuilder, ignoredProvider, onLaunched) -> {
                    if (openExternalBrowser()) onLaunched.run();
                    else showLaunchError();
                });
        } catch (RuntimeException | LinkageError failure) {
            closeLauncher();
            if (!openExternalBrowser()) showLaunchError();
        }
    }

    private boolean openExternalBrowser() {
        Intent browserIntent = new Intent(Intent.ACTION_VIEW, launchUri)
            .addCategory(Intent.CATEGORY_BROWSABLE);
        PackageManager packages = getPackageManager();
        List<String> candidates = new ArrayList<>();
        for (ResolveInfo info : packages.queryIntentActivities(browserIntent, PackageManager.MATCH_DEFAULT_ONLY)) {
            if (info.activityInfo != null) candidates.add(info.activityInfo.packageName);
        }
        String browserPackage = BrowserPackagePolicy.choose(getPackageName(), candidates);
        if (browserPackage == null) return false;
        try {
            startActivity(new Intent(browserIntent).setPackage(browserPackage));
            finish();
            return true;
        } catch (ActivityNotFoundException | SecurityException failure) {
            return false;
        }
    }

    private void showLaunchError() {
        runOnUiThread(() -> {
            launchStarted = false;
            LinearLayout panel = new LinearLayout(this);
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setGravity(Gravity.CENTER);
            int padding = Math.round(28 * getResources().getDisplayMetrics().density);
            panel.setPadding(padding, padding, padding, padding);
            panel.setBackgroundColor(Color.rgb(255, 247, 250));

            TextView title = new TextView(this);
            title.setText(R.string.launch_error_title);
            title.setTextColor(Color.rgb(55, 34, 44));
            title.setTextSize(22);
            title.setGravity(Gravity.CENTER);

            TextView detail = new TextView(this);
            detail.setText(R.string.launch_error_detail);
            detail.setTextColor(Color.rgb(105, 77, 91));
            detail.setTextSize(16);
            detail.setGravity(Gravity.CENTER);
            detail.setPadding(0, padding / 2, 0, padding);

            Button retry = new Button(this);
            retry.setText(R.string.launch_retry);
            retry.setOnClickListener(view -> launch());

            panel.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            panel.addView(detail, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            panel.addView(retry, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            setContentView(panel);
        });
    }

    private void closeLauncher() {
        if (twaLauncher != null) {
            twaLauncher.destroy();
            twaLauncher = null;
        }
    }

    @Override protected void onDestroy() {
        closeLauncher();
        super.onDestroy();
    }
}
