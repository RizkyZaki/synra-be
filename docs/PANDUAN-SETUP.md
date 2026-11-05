# Panduan Menjalankan Backend SYNRA

Panduan ini untuk menjalankan backend SYNRA dari nol di komputer kantor. Referensi lengkap
variabel `.env`, role, dan alur alert ada di [README](../README.md).

Ada dua cara menjalankan, pilih sesuai kebutuhan:

| Cara | Sumber data | Kapan dipakai |
|---|---|---|
| **A. Data simulasi** | Elasticsearch lokal + simulator | Mencoba aplikasi, development |
| **B. Elasticsearch kantor** | ES kantor (read-only) | Membaca data monitoring asli |

Mulai dari cara A supaya yakin semuanya berjalan, baru lanjut ke cara B.

## 1. Yang perlu disiapkan

- Node.js 22 atau lebih baru (`node -v`)
- Docker Desktop dalam keadaan menyala (`docker ps` tidak error)
- Akses ke repo `RizkyZaki/synra-be` (private)
- Port `3000`, `5432`, dan `9200` tidak sedang dipakai aplikasi lain

Untuk cara B, tambahannya:

- Komputer berada di jaringan kantor
- URL Elasticsearch kantor dan akun **read-only** (username/password atau API key). Minta ke
  pengelola Elasticsearch, jangan dimasukkan ke repo.

## 2. Ambil kode dan buat `.env`

Jalankan di Git Bash (Windows) atau terminal biasa:

```bash
git clone https://github.com/RizkyZaki/synra-be.git
cd synra-be
cp .env.example .env
npm install
```

Lalu buka `.env` dan isi nilai berikut:

| Variabel | Isi dengan |
|---|---|
| `POSTGRES_PASSWORD` | Password database bebas, tanpa karakter `@ : / ?` |
| `DATABASE_URL` | Ganti `ganti_password_db` dengan password yang **sama persis** dengan `POSTGRES_PASSWORD` |
| `JWT_SECRET` | Hasil perintah di bawah |
| `SEED_ADMIN_PASSWORD` | Password akun admin, minimal 8 karakter |
| `SEED_DEMO_PASSWORD` | Opsional. Bila diisi, seed membuat user demo: `supervisor`, `operator`, `manajemen`, `auditor` |

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

File `.env` tidak ikut ke git. Jangan membagikannya lewat chat.

## 3. Cara A: dengan data simulasi

```bash
docker compose up -d postgres elasticsearch
npx prisma migrate deploy
npm run seed
npm run start:dev
```

Biarkan terminal itu berjalan. Di terminal baru, isi data uji:

```bash
npm run simulate
```

Simulator mengirim data 24 jam ke belakang, lalu data baru tiap 10 detik. Backend membacanya
setiap 5 menit. Tekan `Ctrl+C` untuk menghentikan simulator.

## 4. Cara B: dengan Elasticsearch kantor

Backend harus dijalankan langsung seperti di bawah, **bukan** dengan
`docker compose up backend`. Container backend selalu memakai Elasticsearch lokal, jadi nilai
`ELASTICSEARCH_NODE` di `.env` akan diabaikan.

Ubah `.env`:

```env
ELASTICSEARCH_NODE=https://alamat-es-kantor:9200
ELASTICSEARCH_USERNAME=isi_akun_read_only
ELASTICSEARCH_PASSWORD=isi_password
# Isi bila ES memakai sertifikat CA internal
ELASTICSEARCH_CA_CERT_PATH=
SEED_SAMPLE_ASSETS=false
```

`SEED_SAMPLE_ASSETS=false` mencegah aset contoh ikut dibuat, karena aset itu tidak punya data
dan akan memicu alert `HOST_STALE`. Kalau aset contoh terlanjur ada, nonaktifkan lewat menu aset.

Jalankan:

```bash
docker compose up -d postgres
npx prisma migrate deploy
npm run seed
npm run start:dev
```

Setelah itu daftarkan server yang dipantau sebagai **Host** dan **Aset**. Kolom `hostname` aset
harus sama persis dengan `host.name` di Metricbeat. Data dari hostname yang belum terdaftar
tidak disimpan, dan namanya dicatat di `unknownHosts` pada riwayat ingest.

> **Penting:** jangan menjalankan `npm run simulate` pada cara B. Simulator menulis data, dan
> Elasticsearch kantor hanya boleh dibaca.

## 5. Cek apakah sudah berjalan

```bash
curl http://localhost:3000/health
```

Lalu buka Swagger di <http://localhost:3000/api/docs>:

1. Panggil `POST /api/v1/auth/login` dengan username `admin` dan password `SEED_ADMIN_PASSWORD`.
2. Salin `accessToken`, klik **Authorize**, dan tempelkan.
3. Panggil `GET /api/v1/assets`. Pada cara A hasilnya berisi 8 aset contoh.

Untuk mengambil data sekarang tanpa menunggu jadwal, panggil `POST /api/v1/ingestion/run`.

## 6. Menjalankan sehari-hari

```bash
docker compose up -d postgres elasticsearch   # cara B cukup: postgres
npm run start:dev
```

Setelah `git pull`, jalankan ini sebelum start, karena dependensi atau skema bisa berubah:

```bash
npm install
npx prisma migrate deploy
```

Untuk mematikan database: `docker compose stop`. Data tetap tersimpan.

## 7. Kalau ada masalah

| Gejala | Penyebab | Solusi |
|---|---|---|
| `docker` error `cannot find the file specified` | Docker Desktop belum menyala | Nyalakan Docker Desktop, tunggu sampai siap |
| Error `P1000` / autentikasi database gagal | Password di `DATABASE_URL` beda dengan `POSTGRES_PASSWORD`, atau volume lama memakai password lain | Samakan password. Bila database memang masih kosong, lihat catatan di bawah |
| Error `P1001` / tidak bisa ke database | Container Postgres belum jalan | `docker compose up -d postgres`, lalu `docker compose ps` |
| Port `3000`, `5432`, atau `9200` sudah dipakai | Ada aplikasi lain di port itu | Matikan aplikasi tersebut. Untuk `3000`, bisa juga ganti `PORT` |
| Backend gagal start karena konfigurasi | `JWT_SECRET` kurang dari 32 karakter atau `.env` belum lengkap | Isi sesuai langkah 2 |
| `SEED_ADMIN_PASSWORD wajib diisi` | Password admin kosong atau kurang dari 8 karakter | Isi di `.env`, lalu ulangi `npm run seed` |
| Login ditolak terus | Akun terkunci setelah 5x gagal | Tunggu 15 menit atau minta ADMIN membuka kunci |
| Data tidak masuk | ES tidak terjangkau, atau hostname belum terdaftar | Pastikan di jaringan kantor, lalu cek log backend dan `unknownHosts` |
| Error sertifikat TLS ke ES | ES memakai CA internal | Isi `ELASTICSEARCH_CA_CERT_PATH` dengan path file CA |

Catatan: `docker compose down -v` **menghapus seluruh isi database**. Pakai hanya bila database
memang masih kosong atau boleh hilang.
