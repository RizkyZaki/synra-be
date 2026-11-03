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
  LAST_ADMIN: 'Tidak dapat mengubah admin aktif terakhir. Minimal harus ada satu ADMIN aktif.',

  // BPD & aset
  BPD_NOT_FOUND: 'BPD tidak ditemukan.',
  BPD_CODE_TAKEN: 'Kode BPD sudah digunakan.',
  BPD_HAS_ASSETS: 'BPD tidak dapat dihapus karena masih memiliki aset.',
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
  ALERT_EVIDENCE_REQUIRED: 'Bukti remediasi wajib diisi sebelum review.',
  EVALUATION_RUNNING: 'Evaluasi threshold sedang berjalan. Coba lagi beberapa saat lagi.',

  // Notifikasi
  TELEGRAM_NOT_CONFIGURED: 'Telegram belum dikonfigurasi (TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID).',
  TELEGRAM_FAILED: (reason: string) => `Gagal mengirim pesan Telegram: ${reason}`,

  // Dashboard & laporan
  DATE_RANGE_INVALID: 'Tanggal mulai harus sebelum tanggal akhir.',
  DATE_RANGE_TOO_LONG: 'Rentang waktu maksimal 90 hari.',
} as const;
