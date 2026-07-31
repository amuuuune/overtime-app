package io.github.amuuuune.overtimeclockout;

import android.app.Activity;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.Patterns;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.security.GeneralSecurityException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class SetupActivity extends Activity {
    static final String EXTRA_MESSAGE = "setup_message";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SessionStore sessionStore;
    private EditText emailInput;
    private Button submitButton;
    private TextView statusText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        sessionStore = new SessionStore(this);
        buildContent();

        String message = getIntent().getStringExtra(EXTRA_MESSAGE);
        if (message != null && !message.isEmpty()) {
            setStatus(message, false);
        }
        handleAuthIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAuthIntent(intent);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void buildContent() {
        int horizontalPadding = dp(24);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(horizontalPadding, dp(48), horizontalPadding, dp(32));

        TextView title = new TextView(this);
        title.setText(R.string.setup_title);
        title.setTextColor(Color.rgb(32, 37, 34));
        title.setTextSize(24);
        title.setGravity(Gravity.START);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        content.addView(title, matchWrap(dp(0)));

        TextView introduction = new TextView(this);
        introduction.setText(R.string.setup_intro);
        introduction.setTextColor(Color.rgb(95, 103, 98));
        introduction.setTextSize(15);
        introduction.setLineSpacing(0, 1.35f);
        LinearLayout.LayoutParams introParams = matchWrap(dp(14));
        introParams.bottomMargin = dp(22);
        content.addView(introduction, introParams);

        emailInput = new EditText(this);
        emailInput.setHint(R.string.email_hint);
        emailInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        emailInput.setSingleLine(true);
        emailInput.setImeOptions(EditorInfo.IME_ACTION_DONE);
        emailInput.setText(sessionStore.loadEmail());
        emailInput.setTextSize(16);
        LinearLayout.LayoutParams emailParams = matchWrap(0);
        emailParams.bottomMargin = dp(16);
        content.addView(emailInput, emailParams);

        submitButton = new Button(this);
        submitButton.setText(R.string.send_login_email);
        submitButton.setTextColor(Color.WHITE);
        submitButton.setTextSize(16);
        submitButton.setAllCaps(false);
        submitButton.setMinHeight(dp(52));
        submitButton.setBackgroundTintList(ColorStateList.valueOf(Color.rgb(21, 154, 85)));
        submitButton.setOnClickListener(view -> sendLoginEmail());
        content.addView(submitButton, matchWrap(0));

        statusText = new TextView(this);
        statusText.setTextColor(Color.rgb(95, 103, 98));
        statusText.setTextSize(14);
        statusText.setLineSpacing(0, 1.3f);
        LinearLayout.LayoutParams statusParams = matchWrap(dp(16));
        statusParams.bottomMargin = dp(24);
        content.addView(statusText, statusParams);

        View divider = new View(this);
        divider.setBackgroundColor(Color.rgb(225, 231, 227));
        LinearLayout.LayoutParams dividerParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(1)
        );
        dividerParams.bottomMargin = dp(18);
        content.addView(divider, dividerParams);

        TextView note = new TextView(this);
        note.setText(R.string.setup_note);
        note.setTextColor(Color.rgb(95, 103, 98));
        note.setTextSize(13);
        note.setLineSpacing(0, 1.35f);
        content.addView(note, matchWrap(0));

        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.addView(content);
        setContentView(scrollView);

        emailInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                sendLoginEmail();
                return true;
            }
            return false;
        });
    }

    private void sendLoginEmail() {
        String email = emailInput.getText().toString().trim();
        if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            setStatus("メールアドレスを確認してください。", true);
            return;
        }

        setBusy(true);
        setStatus("ログインメールを送信しています。", false);
        executor.execute(() -> {
            try {
                new SupabaseClient().sendLoginEmail(email);
                sessionStore.saveEmail(email);
                runOnUiThread(() -> {
                    setBusy(false);
                    setStatus("メールを送信しました。届いたメールの「Log In」を押してください。", false);
                });
            } catch (SupabaseClient.ClientException error) {
                runOnUiThread(() -> {
                    setBusy(false);
                    setStatus("メールを送信できませんでした。少し待ってからもう一度お試しください。", true);
                });
            }
        });
    }

    private void handleAuthIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"overtimeclockout".equals(data.getScheme())) {
            return;
        }

        Map<String, String> values = parseFragment(data.getFragment());
        String accessToken = data.getQueryParameter("access_token");
        String refreshToken = data.getQueryParameter("refresh_token");
        if (accessToken == null || accessToken.isEmpty()) {
            accessToken = values.getOrDefault("access_token", "");
        }
        if (refreshToken == null || refreshToken.isEmpty()) {
            refreshToken = values.getOrDefault("refresh_token", "");
        }
        if (accessToken.isEmpty() || refreshToken.isEmpty()) {
            setStatus("ログイン情報を受け取れませんでした。メールをもう一度送信してください。", true);
            return;
        }

        try {
            sessionStore.save(new SessionStore.Session(accessToken, refreshToken));
            emailInput.setVisibility(View.GONE);
            submitButton.setVisibility(View.GONE);
            setStatus("連携しました。次回から「退勤」アイコンを押すだけで打刻できます。", false);
        } catch (GeneralSecurityException | org.json.JSONException error) {
            setStatus("ログイン情報を安全に保存できませんでした。もう一度お試しください。", true);
        }
    }

    private Map<String, String> parseFragment(String rawFragment) {
        Map<String, String> values = new HashMap<>();
        if (rawFragment == null || rawFragment.isEmpty()) {
            return values;
        }
        for (String pair : rawFragment.split("&")) {
            int separator = pair.indexOf('=');
            String key = separator >= 0 ? pair.substring(0, separator) : pair;
            String value = separator >= 0 ? pair.substring(separator + 1) : "";
            values.put(Uri.decode(key), Uri.decode(value));
        }
        return values;
    }

    private void setBusy(boolean busy) {
        emailInput.setEnabled(!busy);
        submitButton.setEnabled(!busy);
    }

    private void setStatus(String message, boolean error) {
        statusText.setText(message);
        statusText.setTextColor(error ? Color.rgb(177, 48, 48) : Color.rgb(72, 82, 76));
    }

    private LinearLayout.LayoutParams matchWrap(int topMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.topMargin = topMargin;
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
