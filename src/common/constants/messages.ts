/** Pesan error untuk pengguna (Bahasa Indonesia). */
export const MSG = {
  // Umum
  INTERNAL_ERROR: 'Terjadi kesalahan pada server. Silakan coba lagi.',
  NOT_FOUND_ROUTE: 'Endpoint tidak ditemukan.',
  VALIDATION_FAILED: 'Data yang dikirim tidak valid.',
  DUPLICATE: 'Data sudah ada.',
  RECORD_NOT_FOUND: 'Data tidak ditemukan.',
  RELATION_CONFLICT: 'Data masih digunakan oleh data lain.',
  TOO_MANY_REQUESTS: 'Terlalu banyak permintaan. Coba lagi nanti.',

  // Auth
  AUTH_REQUIRED: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.',
  FORBIDDEN: 'Anda tidak memiliki akses ke fitur ini.',
  INVALID_CREDENTIALS: 'Username atau password salah.',
  ACCOUNT_INACTIVE: 'Akun dinonaktifkan. Hubungi administrator.',
  ACCOUNT_LOCKED: (until: string) =>
    `Akun terkunci karena terlalu banyak percobaan login gagal. Coba lagi setelah ${until} atau hubungi administrator.`,
  ACCOUNT_JUST_LOCKED: (minutes: number) =>
    `Username atau password salah. Akun dikunci selama ${minutes} menit karena terlalu banyak percobaan gagal.`,
  REMAINING_ATTEMPTS: (n: number) => `Username atau password salah. Sisa percobaan: ${n}.`,
  WRONG_OLD_PASSWORD: 'Password lama salah.',
  SAME_PASSWORD: 'Password baru tidak boleh sama dengan password lama.',

  // Users
  USER_NOT_FOUND: 'User tidak ditemukan.',
  USERNAME_TAKEN: 'Username sudah digunakan.',
  CANNOT_MODIFY_SELF: 'Anda tidak dapat mengubah role atau menonaktifkan akun sendiri.',
  LAST_ADMIN: 'Tidak dapat mengubah admin aktif terakhir. Minimal harus ada satu Administrator aktif.',
  USER_OUT_OF_REACH: 'Anda tidak dapat mengelola pengguna dengan hak akses melebihi milik Anda.',

  // Role & hak akses
  ROLE_NOT_FOUND: 'Role tidak ditemukan.',
  ROLE_NAME_TAKEN: 'Nama role sudah digunakan.',
  ROLE_CODE_TAKEN: 'Kode role sudah digunakan.',
  ROLE_SYSTEM_DELETE: 'Role bawaan sistem tidak dapat dihapus.',
  ROLE_IN_USE: (n: number) => `Role masih dipakai ${n} pengguna. Pindahkan pengguna ke role lain terlebih dahulu.`,
  ROLE_ADMIN_LOCKED: 'Hak akses role Administrator selalu penuh dan tidak dapat diubah.',
  ROLE_OUT_OF_REACH: 'Anda tidak dapat memberikan role atau hak akses yang melebihi milik Anda.',
  PERMISSION_UNKNOWN: (keys: string) => `Hak akses tidak dikenal: ${keys}.`,

  // Host & aset
  HOST_NOT_FOUND: 'Host tidak ditemukan.',
  HOST_CODE_TAKEN: 'Kode Host sudah digunakan.',
  HOST_HAS_ASSETS: 'Host tidak dapat dihapus karena masih memiliki aset.',
  SUPERVISOR_INVALID: 'Supervisor harus user aktif dengan role yang memiliki hak "Supervisor aset".',
  // Siklus hidup
  LIFECYCLE_NOT_FOUND: 'Item siklus hidup tidak ditemukan.',
  LIFECYCLE_QUOTA: 'Jumlah terpakai tidak boleh melebihi kuota.',
  RENEWAL_NOT_FOUND: 'Pengajuan perpanjangan tidak ditemukan.',
  RENEWAL_PENDING_EXISTS: 'Item ini sudah punya pengajuan perpanjangan yang menunggu keputusan.',
  RENEWAL_ALREADY_DECIDED: 'Pengajuan ini sudah diputuskan.',
  RENEWAL_EXPIRY_NOT_LATER: 'Tanggal berakhir baru harus setelah tanggal berakhir saat ini.',

  ASSET_NOT_FOUND: 'Aset tidak ditemukan.',
  HOSTNAME_TAKEN: 'Hostname sudah terdaftar.',
  ASSET_HAS_ALERTS: 'Aset tidak dapat dihapus karena memiliki riwayat alert. Nonaktifkan aset sebagai gantinya.',

  // Ingestion
  INGEST_RUNNING: 'Proses ingest sedang berjalan. Coba lagi beberapa saat lagi.',
  ES_UNAVAILABLE: 'Elasticsearch tidak dapat dihubungi.',
  CSV_REQUIRED: 'File CSV wajib diunggah (field "file").',
  CSV_INVALID: 'Format CSV tidak valid.',
  CSV_TOO_LARGE: 'File CSV maksimal 5 MB.',

  // Threshold
  THRESHOLD_ORDER: (metric: string) =>
    `Nilai threshold ${metric} harus naik sesuai urutan severity (INFO < LOW < MEDIUM < HIGH < CRITICAL).`,
  THRESHOLD_DUPLICATE: (metric: string) => `Severity ganda pada threshold ${metric}.`,
  THRESHOLD_NOT_FOUND: 'Aturan threshold tidak ditemukan.',
  THRESHOLD_PERCENT_RANGE: 'Nilai threshold persen harus di antara 0 dan 100.',
  THRESHOLD_EMPTY: 'Minimal satu level threshold wajib diisi.',

  // Alert
  ALERT_NOT_FOUND: 'Alert tidak ditemukan.',
  ALERT_INVALID_TRANSITION: (from: string, to: string) =>
    `Status alert tidak dapat diubah dari ${from} ke ${to}.`,
  ALERT_STATUS_CHANGED: 'Status alert sudah diubah oleh pengguna lain. Muat ulang data.',
  ALERT_NOTE_REQUIRED: 'Catatan wajib diisi.',
  ALERT_EVIDENCE_REQUIRED: 'Isi bukti remediasi atau lampirkan minimal satu file sebelum mengajukan review.',
  ATTACHMENT_REQUIRED: 'Pilih minimal satu file.',
  ATTACHMENT_TYPE: 'Jenis file tidak didukung. Gunakan PNG, JPG, WEBP, PDF, TXT, LOG, atau CSV.',
  ATTACHMENT_CONTENT: (name: string) => `Isi file "${name}" tidak sesuai dengan jenisnya.`,
  ATTACHMENT_LIMIT: (max: number) => `Maksimal ${max} lampiran per alert.`,
  ATTACHMENT_CLOSED: 'Alert yang sudah ditutup tidak dapat ditambah lampiran.',
  ATTACHMENT_NOT_FOUND: 'Lampiran tidak ditemukan.',
  EVALUATION_RUNNING: 'Evaluasi threshold sedang berjalan. Coba lagi beberapa saat lagi.',

  // Notifikasi
  TELEGRAM_NOT_CONFIGURED: 'Telegram belum dikonfigurasi (TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID).',
  TELEGRAM_FAILED: (reason: string) => `Gagal mengirim pesan Telegram: ${reason}`,

  // Dashboard & laporan
  DATE_RANGE_INVALID: 'Tanggal mulai harus sebelum tanggal akhir.',
  DATE_RANGE_TOO_LONG: 'Rentang waktu maksimal 90 hari.',
} as const;
