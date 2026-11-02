# HUNTER MESSAGE — İlk gerçek zamanlı mesajlaşma iskeleti

Bu sürüm React + TypeScript + Firebase + Capacitor ile üretilmiştir. E-posta/şifre kaydı, telefonla SMS doğrulama, benzersiz kullanıcı adı, arama, birebir sohbet, gerçek zamanlı mesajlaşma ve açık/koyu tema içerir. **Uçtan uca şifreleme, dosya transferi, ses/video arama, grup ve cihaz bildirimleri bu sürümde YOKTUR.** Uygulamayı test sürümü olarak değerlendirin.

## Firebase kurulumu
1. https://console.firebase.google.com/ adresinden yeni proje açın. Authentication > Sign-in method bölümünde **Email/Password** ve isterseniz **Phone** yöntemlerini etkinleştirin. Telefon doğrulaması için ücretlendirme, SMS bölge politikaları ve reCAPTCHA/uygulama doğrulama ayarlarını yapın.
2. Firestore Database oluşturun. `firestore.rules` kurallarını Firebase Console > Firestore > Rules bölümüne kopyalayıp yayınlayın. **Varsayılan test mode kurallarıyla devam etmeyin.** `firestore.indexes.json` içinde bulunan indeks gerekirse Firebase CLI ile uygulanabilir.
3. Firebase Project Settings > Web app oluşturun ve çıkan web config değerlerini `.env.example` kopyası olan `.env` içine yerleştirin. `VITE_` değerleri istemci uygulamasında görünür; **servis hesabı özel anahtarlarını buraya ASLA koymayın.**
4. Authentication > Settings > Authorized Domains bölümünde web alan adınızı ve yerel test için gerekirse localhost'u yetkilendirin.

## Bilgisayarda çalıştırma
Node.js 22 kurulu olmalı.
```bash
npm install
cp .env.example .env
# .env içine kendi Firebase değerlerini koy
npm run dev
```
Tarayıcıda konsolda gösterilen `http://localhost:5173/` adresini açın. Test için iki ayrı hesap ve iki tarayıcı penceresi kullanın.

## GitHub Actions ile Android APK
1. ZIP'i **klasörün içindekileri depo köküne gelecek şekilde** GitHub'da yeni `hunter-message` deposuna aktarın. `.github/workflows/android-apk.yml` dosyasının gizli noktalı klasörüyle birlikte yüklendiğinden emin olun.
2. GitHub > Settings > Secrets and variables > Actions > New repository secret yoluyla altı `VITE_FIREBASE_...` değişkenini tek tek ekleyin.
3. Actions > `HUNTER MESSAGE Android APK` > `Run workflow` düğmesine basın (veya main dalına push edin).
4. Çalışma tamamlanınca `hunter-message-debug-apk` isimli **artifact** dosyasını indirin. İçindeki `app-debug.apk` dosyası Android test kurulumu içindir; mağaza yayını için imzalı release oluşturulmalıdır.
5. Android içindeki telefon doğrulama işlemi için Firebase'in Android doğrulama, SHA fingerprint ve yetkili domain ayarları ayrıca yapılmalıdır. Native WebView'deki reCAPTCHA uyumsuzlukları test edilmelidir; üretimde native Auth plugin veya özel tarayıcı akışı gerekebilir.

## Web yayını
`npm run build` komutundan sonra `dist/` statik web çıktısıdır. Firebase Hosting kullanmak isterseniz Firebase CLI ile kendi projenizde `firebase deploy --only hosting,firestore` yapabilirsiniz.

## Güvenlik ve kapsam uyarıları
- Firebase Auth oturum açmayı sağlar; mesajları **uçtan uca şifrelemez**. Firestore erişim kuralları yalnızca yetkilendirme sağlar. Mesaj içerikleri Firebase üzerinde düz metin tutulur. Gizlilik/şifreleme vaadinde bulunmayın.
- Profil araması, benzersiz kullanıcı adı ve sohbet erişimi için başlangıç güvenlik kuralları vardır. Genel kullanıma açmadan önce Emulator Suite ile kuralları saldırgan senaryolarında test edin.
- Bu V1'de kimliği doğrulanan başka bir kullanıcıya kullanıcı adı üzerinden doğrudan sohbet başlatılabilir; arkadaşlık isteği ve engelleme henüz yoktur.
- Giriş yapan herkes başka bir kullanıcının herkese açık profil bilgilerini kullanıcı adına göre öğrenebilir. Telefon numarası profil belgesine yazılmaz.
- Kötüye kullanım engelleme, hız sınırlama, spam tespiti, şikâyet sistemi, kullanıcı hesabı silme ve içerik moderasyon politikaları daha sonra eklenmelidir. Bunlar tamamlanmadan herkese açık mağazada yayınlamayın.
- Android ve Web için gerçek Firebase yapılandırma değerleri gerekli olduğundan ZIP tek başına canlı mesaj alışverişi başlatmaz.
