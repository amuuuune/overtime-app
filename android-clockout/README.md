# 退勤 Android補助アプリ

既存の「17+」PWAとは別のランチャーアイコンから、タップ時刻をSupabaseへ直接保存する小さなAndroidアプリです。

## 動作

1. 初回起動時だけ、Supabaseで使用中のメールアドレスを入力します。
2. メールのログインリンクから `android-auth/` を経由してこのアプリへ戻り、端末内にセッションを暗号化保存します。
3. 以後は「退勤」アイコンを押すと、タップした時点の時刻で残業を計算して `overtime_records` へ保存します。
4. 既存レコードは上書きしません。

公開キーだけをアプリに含めています。ユーザーのアクセストークンと更新トークンはAndroid KeystoreのAES-GCM鍵で暗号化し、RLSを通して本人の行だけを操作します。

## Supabase設定

AuthenticationのRedirect URLsへ次を追加します。

```text
https://amuuuune.github.io/overtime-app/android-auth/
```

既存のテーブルやRLSポリシーの変更は不要です。

## ビルド

- JDK 17
- Android SDK Platform 35
- Android SDK Build Tools 34.0.0
- Gradle 8.9
- Android Gradle Plugin 8.7.3

署名設定は、Git管理外の `../.secrets/clock-out-signing.properties` から読み込みます。

```powershell
./gradlew testDebugUnitTest assembleRelease
```

リリースAPKは `app/build/outputs/apk/release/app-release.apk` に生成されます。

## 通常打刻の範囲

- 17:00以降を残業として計算
- 17:00〜17:15、19:15〜19:30、21:30〜21:45を除外
- 秒を切り捨てて1分単位
- Supabaseに保存済みの早出打刻を加算
- 土日と5:00より前は、休日・日またぎの判断が必要なため「17+」を案内
- 直近12期間より古いクラウド記録を打刻後に削除
