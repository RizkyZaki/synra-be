# ERD SYNRA

Disusun dari `prisma/schema.prisma` (migrasi `init` + `alert_condition_active` + `host_supervisor_asset_audit`).
Garis putus-putus = referensi logis tanpa foreign key (id pelaku disimpan sebagai riwayat,
tetap valid walau user dinonaktifkan).

```mermaid
erDiagram
    Host ||--o{ Asset : "memiliki"
    Asset ||--o{ Metric : "menghasilkan"
    Asset ||--o{ Alert : "memicu"
    Alert ||--o{ AlertEvent : "riwayat status"
    Alert |o--o{ NotificationLog : "dinotifikasi"
    User |o..o{ AuditLog : "pelaku"
    User |o..o{ AlertEvent : "pelaku"
    User |o..o{ ThresholdRule : "diubah oleh"
    User |o..o{ Alert : "ack / close"
    User |o..o{ Asset : "input / update / supervisor"

    User {
        uuid id PK
        string username UK
        string passwordHash "bcrypt"
        string fullName
        Role role
        bool isActive "default true"
        int failedLoginCount "lockout setelah 5x"
        datetime lockedUntil "nullable"
        datetime lastLoginAt "nullable"
        datetime createdAt
        datetime updatedAt
    }
    Host {
        uuid id PK
        string code UK "mis. BPD-JTG"
        string name
        string region "nullable"
        datetime createdAt
        datetime updatedAt
    }
    Asset {
        uuid id PK
        string hostname UK "= host.name Metricbeat"
        string ipAddress
        string component "CORE_BANKING, DATABASE, ..."
        uuid hostId FK
        AssetCategory category "nullable untuk aset lama"
        string type "nullable, mis. CPU, VM"
        string picName
        string picContact "nullable"
        string notes "nullable"
        bool isActive "default true"
        bool isStale "default false"
        datetime lastSeenAt "nullable"
        uuid userInputId "nullable, ref User"
        datetime dtimeInput
        uuid userUpdateId "nullable, ref User"
        datetime timeUpdate "nullable, waktu edit user"
        uuid supervisorInputId "nullable, ref User"
        uuid supervisorUpdateId "nullable, ref User"
        datetime updatedAt "ikut berubah saat ingest"
    }
    Metric {
        bigint id PK
        uuid assetId FK "on delete cascade"
        MetricType metric
        string label "mount point DISK, default kosong"
        float value "persen 0-100 / ms / jumlah"
        datetime timestamp
        IngestSource source
    }
    ThresholdRule {
        uuid id PK
        RuleMetric metric "unik bersama severity"
        Severity severity
        ThresholdOperator operator "default GT"
        float value "persen / menit (HOST_STALE)"
        bool enabled "default true"
        string recommendation "nullable"
        uuid updatedById "nullable, ref User"
        datetime createdAt
        datetime updatedAt
    }
    Alert {
        uuid id PK
        int number UK "autoincrement, tampil ALT-001"
        uuid assetId FK
        RuleMetric metric
        string label "default kosong"
        Severity severity
        AlertStatus status "default NEW"
        string dedupKey UK "null saat CLOSED"
        string problem
        float value
        float lastValue
        float thresholdValue
        string picName "snapshot"
        string recommendation
        datetime detectedAt
        datetime lastEvaluatedAt
        bool conditionActive "default true"
        datetime recoveredAt "nullable"
        datetime acknowledgedAt "nullable"
        uuid acknowledgedById "nullable, ref User"
        datetime closedAt "nullable"
        uuid closedById "nullable, ref User"
        string closeNote "nullable, wajib saat CLOSED"
    }
    AlertEvent {
        uuid id PK
        uuid alertId FK "on delete cascade"
        AlertAction action
        AlertStatus fromStatus "nullable"
        AlertStatus toStatus
        string note "nullable"
        string evidence "nullable"
        uuid actorId "nullable, ref User"
        string actorUsername "system untuk aksi otomatis"
        datetime createdAt
    }
    NotificationLog {
        uuid id PK
        uuid alertId FK "nullable (pesan uji)"
        AlertAction event
        string channel "default TELEGRAM"
        NotifStatus status
        string message
        string error "nullable"
        datetime createdAt
    }
    AuditLog {
        bigint id PK
        AuditAction action
        uuid actorId "nullable, ref User"
        string actorUsername
        string entity "nullable"
        string entityId "nullable"
        json before "nullable"
        json after "nullable"
        string ipAddress "nullable"
        string userAgent "nullable"
        datetime createdAt
    }
    IngestionState {
        string id PK "metricbeat-* / filebeat-*"
        datetime lastTimestamp "cursor"
        datetime updatedAt
    }
    IngestionRun {
        uuid id PK
        IngestSource source
        datetime startedAt
        datetime finishedAt "nullable"
        int docsRead
        int metricsSaved
        string_array unknownHosts
        string error "nullable"
    }
```

## Enum

| Enum | Nilai |
|---|---|
| `Role` | ADMIN, SUPERVISOR, OPERATOR, MANAGEMENT, AUDITOR |
| `Severity` | INFO, LOW, MEDIUM, HIGH, CRITICAL |
| `MetricType` | CPU, MEMORY, DISK, UPTIME, LOG_ERROR_COUNT |
| `RuleMetric` | CPU, MEMORY, DISK, HOST_STALE |
| `ThresholdOperator` | GT, GTE |
| `IngestSource` | ELASTICSEARCH, CSV |
| `AssetCategory` | HARDWARE, SOFTWARE |
| `NotifStatus` | SENT, FAILED, SKIPPED |
| `AlertStatus` | NEW, ACKNOWLEDGED, IN_PROGRESS, PENDING_REVIEW, CLOSED (alur berurutan; PENDING_REVIEW bisa kembali ke IN_PROGRESS) |
| `AlertAction` | CREATED, ACKNOWLEDGED, STARTED, SUBMITTED_REVIEW, RETURNED, CLOSED, SEVERITY_RAISED |
| `AuditAction` | LOGIN_SUCCESS, LOGIN_FAILED, ACCOUNT_LOCKED, PASSWORD_CHANGE, THRESHOLD_CREATE, THRESHOLD_UPDATE, THRESHOLD_DELETE, ALERT_STATUS_CHANGE, ALERT_EVALUATE, ASSET_CREATE, ASSET_UPDATE, ASSET_DELETE, HOST_CREATE, HOST_UPDATE, HOST_DELETE, REPORT_EXPORT, METRIC_IMPORT, USER_CREATE, USER_UPDATE, USER_UNLOCK, USER_RESET_PASSWORD |

## Aturan integritas

| Aturan | Implementasi |
|---|---|
| Satu metrik per aset/metrik/mount/waktu (ingest idempoten) | `UNIQUE (assetId, metric, label, timestamp)` pada `Metric` |
| Tidak ada alert ganda selama alert sebelumnya belum CLOSED | `Alert.dedupKey` unik, berisi `assetId:metric:label`, dikosongkan saat CLOSED |
| Satu level per metrik dan severity | `UNIQUE (metric, severity)` pada `ThresholdRule` |
| Audit tidak bisa diubah atau dihapus | Trigger `BEFORE UPDATE OR DELETE` dan `BEFORE TRUNCATE` pada `AuditLog` |
| Host tidak bisa dihapus selama punya aset | FK `Asset.hostId` (RESTRICT) + validasi service |
| Supervisor pada aset harus user aktif ber-role SUPERVISOR | Validasi service; `null` bila tidak dipilih dan pengisinya bukan supervisor |
| Metrik ikut terhapus bila aset dihapus | FK `Metric.assetId` ON DELETE CASCADE |
| Riwayat alert ikut terhapus bila alert dihapus | FK `AlertEvent.alertId` ON DELETE CASCADE |
| Tidak ada data nasabah | Tidak ada tabel/kolom untuk isi log atau transaksi; Filebeat hanya disimpan sebagai jumlah error |
