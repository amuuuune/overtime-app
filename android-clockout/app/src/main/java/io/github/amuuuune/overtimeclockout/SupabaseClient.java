package io.github.amuuuune.overtimeclockout;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;

final class SupabaseClient {
    private static final String EARLY_START_METADATA_KEY = "pending_early_starts";

    private final JsonHttpClient httpClient = new JsonHttpClient();

    void sendLoginEmail(String email) throws ClientException {
        try {
            JSONObject body = new JSONObject()
                .put("email", email)
                .put("data", new JSONObject())
                .put("create_user", false);
            String redirect = URLEncoder.encode(AppConfig.AUTH_REDIRECT_URL, StandardCharsets.UTF_8.name());
            httpClient.request(
                "POST",
                AppConfig.SUPABASE_URL + "/auth/v1/otp?redirect_to=" + redirect,
                publishableHeaders(),
                body.toString()
            );
        } catch (Exception error) {
            throw translate(error);
        }
    }

    RefreshedSession refreshSession(String refreshToken) throws ClientException {
        try {
            JSONObject body = new JSONObject().put("refresh_token", refreshToken);
            JsonHttpClient.Response response = httpClient.request(
                "POST",
                AppConfig.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
                publishableHeaders(),
                body.toString()
            );
            JSONObject data = new JSONObject(response.body);
            String accessToken = data.optString("access_token", "");
            String nextRefreshToken = data.optString("refresh_token", "");
            if (accessToken.isEmpty() || nextRefreshToken.isEmpty()) {
                throw new ClientException(0, "ログイン情報を更新できませんでした。", false);
            }
            JSONObject user = data.optJSONObject("user");
            if (user == null) {
                user = getUser(accessToken);
            }
            return new RefreshedSession(accessToken, nextRefreshToken, user);
        } catch (Exception error) {
            ClientException translated = translate(error);
            if (translated.status == 400) {
                throw new ClientException(400, translated.getMessage(), true);
            }
            throw translated;
        }
    }

    boolean recordExists(String accessToken, LocalDate workDate) throws ClientException {
        try {
            String date = workDate.format(DateTimeFormatter.ISO_LOCAL_DATE);
            String url = AppConfig.SUPABASE_URL
                + "/rest/v1/overtime_records?select=work_date&work_date=eq."
                + date
                + "&limit=1";
            JsonHttpClient.Response response = httpClient.request("GET", url, authenticatedHeaders(accessToken), null);
            return new JSONArray(response.body).length() > 0;
        } catch (Exception error) {
            throw translate(error);
        }
    }

    void insertRecord(
        String accessToken,
        LocalDate workDate,
        String clockOutAt,
        int overtimeMinutes
    ) throws ClientException {
        try {
            JSONObject body = new JSONObject()
                .put("work_date", workDate.format(DateTimeFormatter.ISO_LOCAL_DATE))
                .put("clock_out_at", clockOutAt)
                .put("overtime_minutes", overtimeMinutes);
            Map<String, String> headers = authenticatedHeaders(accessToken);
            headers.put("Prefer", "return=minimal");
            httpClient.request(
                "POST",
                AppConfig.SUPABASE_URL + "/rest/v1/overtime_records",
                headers,
                body.toString()
            );
        } catch (Exception error) {
            ClientException translated = translate(error);
            if (translated.status == 409) {
                throw new ClientException(409, "この日は打刻済みです。", false);
            }
            throw translated;
        }
    }

    String getEarlyStart(JSONObject user, LocalDate workDate) {
        JSONObject metadata = user == null ? null : user.optJSONObject("user_metadata");
        JSONObject pendingStarts = metadata == null ? null : metadata.optJSONObject(EARLY_START_METADATA_KEY);
        if (pendingStarts == null) {
            return "";
        }
        return pendingStarts.optString(workDate.format(DateTimeFormatter.ISO_LOCAL_DATE), "");
    }

    void clearEarlyStart(String accessToken, JSONObject user, LocalDate workDate) throws ClientException {
        try {
            JSONObject metadata = user == null ? null : user.optJSONObject("user_metadata");
            if (metadata == null) {
                return;
            }
            JSONObject nextMetadata = new JSONObject(metadata.toString());
            JSONObject existingStarts = metadata.optJSONObject(EARLY_START_METADATA_KEY);
            if (existingStarts == null) {
                return;
            }
            JSONObject nextStarts = new JSONObject(existingStarts.toString());
            String date = workDate.format(DateTimeFormatter.ISO_LOCAL_DATE);
            if (!nextStarts.has(date)) {
                return;
            }
            nextStarts.remove(date);
            nextMetadata.put(EARLY_START_METADATA_KEY, nextStarts);

            JSONObject body = new JSONObject().put("data", nextMetadata);
            httpClient.request(
                "PUT",
                AppConfig.SUPABASE_URL + "/auth/v1/user",
                authenticatedHeaders(accessToken),
                body.toString()
            );
        } catch (Exception error) {
            throw translate(error);
        }
    }

    void deleteRecordsBefore(String accessToken, LocalDate retentionStart) throws ClientException {
        try {
            String date = retentionStart.format(DateTimeFormatter.ISO_LOCAL_DATE);
            Map<String, String> headers = authenticatedHeaders(accessToken);
            headers.put("Prefer", "return=minimal");
            httpClient.request(
                "DELETE",
                AppConfig.SUPABASE_URL + "/rest/v1/overtime_records?work_date=lt." + date,
                headers,
                null
            );
        } catch (Exception error) {
            throw translate(error);
        }
    }

    private JSONObject getUser(String accessToken) throws ClientException {
        try {
            JsonHttpClient.Response response = httpClient.request(
                "GET",
                AppConfig.SUPABASE_URL + "/auth/v1/user",
                authenticatedHeaders(accessToken),
                null
            );
            return new JSONObject(response.body);
        } catch (Exception error) {
            throw translate(error);
        }
    }

    private Map<String, String> publishableHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("apikey", AppConfig.SUPABASE_PUBLISHABLE_KEY);
        return headers;
    }

    private Map<String, String> authenticatedHeaders(String accessToken) {
        Map<String, String> headers = publishableHeaders();
        headers.put("Authorization", "Bearer " + accessToken);
        return headers;
    }

    private ClientException translate(Exception error) {
        if (error instanceof ClientException) {
            return (ClientException) error;
        }
        if (error instanceof JsonHttpClient.ApiException) {
            JsonHttpClient.ApiException apiError = (JsonHttpClient.ApiException) error;
            String message = extractMessage(apiError.responseBody);
            boolean needsLogin = apiError.status == 401 || apiError.status == 403;
            return new ClientException(apiError.status, message, needsLogin);
        }
        if (error instanceof JSONException) {
            return new ClientException(0, "Supabaseから不正な応答がありました。", false);
        }
        return new ClientException(0, "処理に失敗しました。", false);
    }

    private String extractMessage(String responseBody) {
        if (responseBody == null || responseBody.isEmpty()) {
            return "Supabaseへの保存に失敗しました。";
        }
        try {
            JSONObject error = new JSONObject(responseBody);
            String[] keys = { "msg", "message", "error_description", "error" };
            for (String key : keys) {
                String value = error.optString(key, "");
                if (!value.isEmpty()) {
                    return value;
                }
            }
        } catch (JSONException ignored) {
            // Fall through to a stable user-facing message.
        }
        return "Supabaseへの保存に失敗しました。";
    }

    static final class RefreshedSession {
        final String accessToken;
        final String refreshToken;
        final JSONObject user;

        RefreshedSession(String accessToken, String refreshToken, JSONObject user) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.user = user;
        }
    }

    static final class ClientException extends Exception {
        final int status;
        final boolean needsLogin;

        ClientException(int status, String message, boolean needsLogin) {
            super(message);
            this.status = status;
            this.needsLogin = needsLogin;
        }
    }
}
