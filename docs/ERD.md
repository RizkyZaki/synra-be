# ERD SYNRA

Disusun dari `prisma/schema.prisma` (migrasi `init` + `alert_condition_active`).
Garis putus-putus = referensi logis tanpa foreign key (id pelaku disimpan sebagai riwayat,
tetap valid walau user dinonaktifkan).

```mermaid
erDiagram
    Bpd ||--o{ Asset : "memiliki"
    Asset ||--o{ Metric : "menghasilkan"
    Asset ||--o{ Alert : "memicu"
    Alert ||--o{ AlertEvent : "riwayat status"
    Alert |o--o{ NotificationLog : "dinotifikasi"
    User |o..o{ AuditLog : "pelaku"
    User |o..o{ AlertEvent : "pelaku"
    User |o..o{ ThresholdRule : "diubah oleh"

    User {
        uuid id PK
        string username UK
        string passwordHash "bcrypt"
        string fullName
        enum role "ADMIN | OPERATOR | MANAGEMENT | AUDITOR"
        bool isActive
        int failedLoginCount "lockout setelah 5x"
        datetime lockedUntil "nullable"
        datetime lastLoginAt "nullable"
    }
    Bpd {
        uuid id PK
        string code UK "mis. BPD-JTG"
        string name
        string region "nullable"
    }
    Asset {
        uuid id PK
        string hostname UK "= host.name Metricbeat"
        string ipAddress
        string component "CORE_BANKING, DATABASE, ..."
        uuid bpdId FK
        string picName
        string picContact "nullable"
        string notes "nullable"
        bool isActive
        bool isStale
        datetime lastSeenAt "nullable"
    }
    Metric {
        bigint id PK
        uuid assetId FK
        enum metric "CPU | MEMORY | DISK | UPTIME | LOG_ERROR_COUNT"
        string label "mount point untuk DISK"
        float value "persen 0-100 / ms / jumlah"
        datetime timestamp
        enum source "ELASTICSEARCH | CSV"
    }
    ThresholdRule {
        uuid id PK
        enum metric "CPU | MEMORY | DISK | HOST_STALE"
        enum severity "INFO..CRITICAL"
        enum operator "GT | GTE"
        float value
        bool enabled
        string recommendation "nullable"
        uuid updatedById "nullable"
    }
    Alert {
        uuid id PK
        int number UK "ALT-001"
        uuid assetId FK
        enum metric
        string label
        enum severity
        enum status "NEW..CLOSED"
        string dedupKey UK "null saat CLOSED"
        string problem
        float value
        float lastValue
        float thresholdValue
        string picName "snapshot"
        string recommendation
        datetime detectedAt
        bool conditionActive
        datetime recoveredAt "nullable"
        datetime closedAt "nullable"
        string closeNote "wajib saat CLOSED"
    }
    AlertEvent {
        uuid id PK
        uuid alertId FK
        enum action "CREATED..CLOSED"
        enum fromStatus "nullable"
        enum toStatus
        string note "nullable"
        string evidence "nullable"
        uuid actorId "nullable"
        string actorUsername
        datetime createdAt
    }
    NotificationLog {
        uuid id PK
        uuid alertId FK "nullable (pesan uji)"
        enum event
        string channel "TELEGRAM"
        enum status "SENT | FAILED | SKIPPED"
        string message
        string error "nullable"
        datetime createdAt
    }
    AuditLog {
        bigint id PK
        enum action
        uuid actorId "nullable"
        string actorUsername
        string entity "nullable"
        string entityId "nullable"
        json before "nullable"
        json after "nullable"
        string ipAddress "nullable"
        datetime createdAt
    }
    IngestionState {
        string id PK "metricbeat-* / filebeat-*"
        datetime lastTimestamp "cursor"
    }
    IngestionRun {
        uuid id PK
        enum source
        datetime startedAt
        datetime finishedAt "nullable"
        int docsRead
        int metricsSaved
        string_array unknownHosts
        string error "nullable"
    }
```

## Aturan integritas

| Aturan | Implementasi |
|---|---|
| Satu metrik per aset/metrik/mount/waktu (ingest idempoten) | `UNIQUE (assetId, metric, label, timestamp)` pada `Metric` |
| Tidak ada alert ganda selama alert sebelumnya belum CLOSED | `Alert.dedupKey` unik, berisi `assetId:metric:label`, dikosongkan saat CLOSED |
| Satu level per metrik dan severity | `UNIQUE (metric, severity)` pada `ThresholdRule` |
| Audit tidak bisa diubah atau dihapus | Trigger `BEFORE UPDATE OR DELETE` dan `BEFORE TRUNCATE` pada `AuditLog` |
| BPD tidak bisa dihapus selama punya aset | FK `Asset.bpdId` (RESTRICT) + validasi service |
| Metrik ikut terhapus bila aset dihapus | FK `Metric.assetId` ON DELETE CASCADE |
| Tidak ada data nasabah | Tidak ada tabel/kolom untuk isi log atau transaksi; Filebeat hanya disimpan sebagai jumlah error |
