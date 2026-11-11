# SYNRA Backend

Backend dashboard monitoring infrastruktur TI SYNRA (PT Collega Inti Pratama).
SYNRA membaca metrik dari Elasticsearch (Metricbeat/Filebeat) secara terjadwal dan read-only,
mengevaluasi threshold, membuat alert, dan mengirim notifikasi Telegram.

Stack: NestJS 11 · PostgreSQL + Prisma 6 · Elasticsearch 8 client · JWT · Swagger.

Baru pertama kali menjalankan? Ikuti [panduan setup](docs/PANDUAN-SETUP.md).

## Prasyarat

- Node.js 22+
- Docker + Docker Compose

## Menjalankan (development)

```bash
cp .env.example .env              # ganti JWT_SECRET, POSTGRES_PASSWORD, SEED_ADMIN_PASSWORD
docker compose up -d postgres elasticsearch
npm install
npx prisma migrate dev            # tabel + trigger audit append-only
npm run seed                      # admin, (opsional) user demo, host + aset contoh
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger (dokumentasi + coba endpoint): `http://localhost:3000/api/docs`
- Health check: `http://localhost:3000/health`

Saat start, backend membuat aturan threshold default (bila belum ada) dan menjalankan ingest
pertama 5 detik kemudian, lalu setiap `INGEST_INTERVAL_MINUTES`.

## Simulator (data uji)

Elasticsearch asli hanya dapat diakses dari jaringan kantor. Untuk development, simulator
mengisi Elasticsearch **lokal** dengan dokumen bergaya Metricbeat dan Filebeat untuk host
contoh yang cocok dengan aset dari `npm run seed`.

```bash
npm run simulate                          # backfill 24 jam, lalu kirim data live tiap 10 detik
npm run simulate -- --hours=6             # backfill 6 jam
npm run simulate -- --no-live             # backfill saja, lalu keluar
npm run simulate -- --reset               # hapus index simulasi dulu
npm run simulate -- --interval=30         # mode live tiap 30 detik
```

Index yang ditulis: `metricbeat-sim-YYYY.MM.DD` dan `filebeat-sim-YYYY.MM.DD`.
Simulator memakai `ELASTICSEARCH_NODE` (atau `SIM_ELASTICSEARCH_NODE`). **Jangan arahkan ke
Elasticsearch produksi.**

| Aset | Host | Skenario | Hasil yang diharapkan |
|---|---|---|---|
| cbs-app-jtg-01 | BPD-JTG | normal | ONLINE |
| cbs-db-jtg-01 | BPD-JTG | disk `/data` hampir penuh (~96%) | alert DISK CRITICAL |
| cbs-app-jtm-01 | BPD-JTM | CPU tinggi 90 menit terakhir | alert CPU HIGH |
| cbs-db-jtm-01 | BPD-JTM | normal | ONLINE |
| web-ib-bali-01 | BPD-BALI | memori tinggi 60 menit terakhir | alert MEMORY HIGH |
| cbs-app-bali-01 | BPD-BALI | host mati (berhenti 30 menit lalu) | STALE + alert HOST_STALE CRITICAL |
| mw-esb-sumut-01 | BPD-SUMUT | disk `/` ~82% | alert DISK MEDIUM |
| cbs-app-sumut-01 | BPD-SUMUT | banyak log ERROR | jumlah error tinggi di metrik |
| test-unregistered-01 | – | tidak didaftarkan | muncul di `unknownHosts` run ingest |

Setelah simulator berjalan, picu ingest manual lewat `POST /api/v1/ingestion/run` (atau tunggu
jadwal) lalu lihat `GET /api/v1/alerts`.

## Menjalankan semua lewat Docker

```bash
docker compose up -d --build      # migrasi dijalankan otomatis saat container backend start
```

Seed dari host: `npm run seed` (dengan `DATABASE_URL` ke `localhost:5432`).

## Test

```bash
npm test
```

Unit test mencakup evaluasi threshold, validasi konfigurasi threshold, deduplikasi alert,
alur status alert, normalisasi data Metricbeat/CSV, status aset, lockout login, RBAC, dan
pesan validasi.

## Variabel `.env`

| Variabel | Default | Keterangan |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `PORT` | `3000` | Port HTTP |
| `CORS_ORIGINS` | – | Origin frontend, pisahkan dengan koma |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | – | Kredensial container Postgres |
| `DATABASE_URL` | – | Connection string Prisma |
| `JWT_SECRET` | – | **Wajib**, minimal 32 karakter acak |
| `JWT_EXPIRES_IN` | `8h` | Masa berlaku token |
| `BCRYPT_ROUNDS` | `12` | Cost bcrypt (10–15) |
| `LOGIN_MAX_ATTEMPTS` | `5` | Gagal login berturut-turut sebelum akun dikunci |
| `LOGIN_LOCKOUT_MINUTES` | `15` | Lama akun terkunci |
| `ELASTICSEARCH_NODE` | `http://localhost:9200` | URL Elasticsearch |
| `ELASTICSEARCH_USERNAME` / `ELASTICSEARCH_PASSWORD` | – | Basic auth (user read-only) |
| `ELASTICSEARCH_API_KEY` | – | Alternatif basic auth |
| `ELASTICSEARCH_CA_CERT_PATH` | – | CA internal bila ES memakai TLS |
| `ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED` | `true` | Verifikasi sertifikat TLS |
| `METRICBEAT_INDEX` / `FILEBEAT_INDEX` | `metricbeat-*` / `filebeat-*` | Pola index yang dibaca |
| `INGEST_ENABLED` | `true` | Aktifkan ingest terjadwal |
| `INGEST_INTERVAL_MINUTES` | `5` | Interval ingest |
| `INGEST_INITIAL_LOOKBACK_HOURS` | `24` | Jangkauan mundur pada run pertama |
| `INGEST_OVERLAP_SECONDS` | `60` | Tumpang-tindih untuk dokumen terlambat (insert idempoten) |
| `INGEST_MAX_DOCS_PER_RUN` | `50000` | Batas dokumen per run; sisanya diambil run berikutnya |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | – | Kosongkan untuk menonaktifkan (tercatat SKIPPED) |
| `REPORT_TIMEZONE` | `Asia/Jakarta` | Zona waktu laporan harian |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_FULLNAME` | – | Akun admin awal |
| `SEED_DEMO_PASSWORD` | – | Bila diisi, seed membuat user `supervisor`, `operator`, `manajemen`, `auditor` |
| `SEED_SAMPLE_ASSETS` | `true` | Buat host + aset contoh yang cocok dengan simulator |

## Role

| Role | Akses |
|---|---|
| ADMIN | Semua: user, host, aset, threshold, review/penutupan alert, evaluasi manual |
| SUPERVISOR | Semua hak OPERATOR, review/penutupan alert, kelola host dan aset |
| OPERATOR | Acknowledge, mulai remediasi, ajukan review alert; ingest manual; impor CSV |
| MANAGEMENT | Read-only: dashboard, aset, alert, laporan (termasuk ekspor) |
| AUDITOR | Read-only + audit log dan ekspornya |

## Alur alert

```
NEW ──acknowledge──▶ ACKNOWLEDGED ──start (catatan)──▶ IN_PROGRESS ──submit-review (catatan + bukti)──▶ PENDING_REVIEW
                                                           ▲                                              │
                                                           └──────────── return (ADMIN, catatan) ◀────────┤
                                                                                                          ▼
                                                                                      close (ADMIN, catatan) ──▶ CLOSED
```

- ADMIN juga dapat menutup langsung dari status terbuka mana pun (mis. false positive); catatan wajib.
- **Deduplikasi:** selama ada alert belum CLOSED untuk aset + metrik (+ mount point untuk disk) yang sama,
  tidak dibuat alert baru; nilai terakhir diperbarui dan severity dinaikkan bila memburuk. Dijamin di
  database lewat kolom unik `dedupKey`.
- Alert yang kondisinya sudah normal ditandai `conditionActive=false` (pulih) tetapi **tidak** ditutup
  otomatis. Status aset hanya memperhitungkan alert yang kondisinya masih aktif.
- Telegram dikirim saat alert dibuat dan setiap perubahan status. Riwayat di `GET /notifications`.

## Threshold default

| Metrik | Level |
|---|---|
| CPU | > 80% HIGH |
| Memori | > 85% HIGH |
| Disk | ≥ 70% LOW (Warning) · ≥ 80% MEDIUM · ≥ 90% HIGH · ≥ 95% CRITICAL |
| Host stale | > 5 menit tanpa data → CRITICAL |

Dapat diubah lewat `PUT /api/v1/thresholds/:metric`. Konfigurasi ditolak bila nilai level aktif
tidak naik sesuai urutan severity. Setiap perubahan tercatat di audit dengan nilai sebelum dan sesudah.

## Siklus hidup

OS end-of-support, lisensi, sertifikat SSL/TLS, garansi, dan kontrak vendor (`/api/v1/lifecycle`).
Setiap item membawa `daysLeft` dan `expiryLevel` (lewat = EXPIRED, ≤30 hari CRITICAL, ≤90 HIGH,
≤180 MEDIUM, ≤365 LOW), dihitung dengan tanggal `REPORT_TIMEZONE`.

| Aksi | Role |
|---|---|
| Lihat item dan pengajuan | Semua role |
| Tambah dan ubah item | ADMIN, SUPERVISOR |
| Hapus item | ADMIN |
| Ajukan perpanjangan (`POST /lifecycle/:id/renewals`) | ADMIN, SUPERVISOR, OPERATOR |
| Setujui atau tolak (`PATCH /lifecycle/renewals/:id`) | ADMIN, SUPERVISOR |

Satu item hanya boleh punya satu pengajuan yang menunggu. Saat disetujui dengan `newExpiryDate`,
tanggal berakhir item diperbarui dan statusnya menjadi RENEWED. Semua aksi tercatat di audit log.

## Catatan keamanan dan data

- Akses ke Elasticsearch hanya membaca (search, point-in-time, aggregation).
- Audit log bersifat append-only: tidak ada endpoint ubah/hapus, dan trigger database menolak
  `UPDATE`, `DELETE`, dan `TRUNCATE` pada tabel `AuditLog`.
- SYNRA tidak menyimpan data nasabah atau transaksi. Dari Filebeat hanya diambil waktu terakhir
  host terlihat dan jumlah log ERROR; isi pesan log tidak dibaca maupun disimpan.
