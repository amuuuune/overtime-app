package io.github.amuuuune.overtimeclockout;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SessionStore {
    private static final String PREFERENCES_NAME = "clock_out_secure_session";
    private static final String KEY_ALIAS = "clock_out_session_key_v1";
    private static final String VALUE_CIPHERTEXT = "session_ciphertext";
    private static final String VALUE_IV = "session_iv";
    private static final String VALUE_EMAIL = "login_email";

    private final SharedPreferences preferences;

    SessionStore(Context context) {
        preferences = context.getApplicationContext()
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    void save(Session session) throws GeneralSecurityException, JSONException {
        JSONObject payload = new JSONObject()
            .put("access_token", session.accessToken)
            .put("refresh_token", session.refreshToken);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] ciphertext = cipher.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8));

        preferences.edit()
            .putString(VALUE_CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .putString(VALUE_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .apply();
    }

    Session load() {
        String encodedCiphertext = preferences.getString(VALUE_CIPHERTEXT, "");
        String encodedIv = preferences.getString(VALUE_IV, "");
        if (encodedCiphertext.isEmpty() || encodedIv.isEmpty()) {
            return null;
        }

        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            GCMParameterSpec parameters = new GCMParameterSpec(128, Base64.decode(encodedIv, Base64.NO_WRAP));
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), parameters);
            byte[] plaintext = cipher.doFinal(Base64.decode(encodedCiphertext, Base64.NO_WRAP));
            JSONObject payload = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
            String accessToken = payload.optString("access_token", "");
            String refreshToken = payload.optString("refresh_token", "");
            if (accessToken.isEmpty() || refreshToken.isEmpty()) {
                clear();
                return null;
            }
            return new Session(accessToken, refreshToken);
        } catch (GeneralSecurityException | JSONException | IllegalArgumentException error) {
            clear();
            return null;
        }
    }

    void clear() {
        preferences.edit()
            .remove(VALUE_CIPHERTEXT)
            .remove(VALUE_IV)
            .apply();
    }

    void saveEmail(String email) {
        preferences.edit().putString(VALUE_EMAIL, email).apply();
    }

    String loadEmail() {
        return preferences.getString(VALUE_EMAIL, "");
    }

    private SecretKey getOrCreateKey() throws GeneralSecurityException {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        try {
            keyStore.load(null);
        } catch (java.io.IOException error) {
            throw new GeneralSecurityException("Android Keystore could not be loaded", error);
        }

        KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    static final class Session {
        final String accessToken;
        final String refreshToken;

        Session(String accessToken, String refreshToken) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
        }
    }
}

