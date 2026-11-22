/**
 * Mengisi riwayat backup contoh LANGSUNG ke tabel BackupRun (Postgres), tanpa Elasticsearch.
 * Dipakai untuk menguji halaman Pencadangan tanpa menjalankan simulator.
 *
 *   npm run seed:backup                 # riwayat 7 hari terakhir sampai sekarang
 *   npm run seed:backup -- --days=14    # riwayat 14 hari
 *   npm run seed:backup -- --reset      # hapus riwayat backup aset contoh dulu
 *
 * Skenario sama dengan simulator (scripts/sim-hosts.ts): aset "failing" punya job yang gagal
 * beberapa jam terakhir, aset "none" tidak punya job (muncul di "Aset Tanpa Backup").
 * Waktu dihitung dari sekarang; jalankan ulang sebelum pengujian agar data tidak "basi".
 * Aset contoh harus sudah terdaftar (`npm run seed`). Hanya untuk database lokal.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { SIM_ASSETS } from './sim-hosts';
import { backupRunsBetween, HOUR } from './sim-backup';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'] as const;
  }),
);
const DAYS = Number(args.get('days') ?? 7);
const RESET = args.get('reset') === 'true';
const FORCE = args.get('force') === 'true';
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'];

const prisma = new PrismaClient();

function databaseHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    return '';
  }
}

async function main() {
  if (!Number.isFinite(DAYS) || DAYS < 1 || DAYS > 30) throw new Error('--days harus di antara 1 dan 30.');
  const dbHost = databaseHost();
  if (!LOCAL_HOSTS.includes(dbHost) && !FORCE) {
    throw new Error(`DATABASE_URL mengarah ke "${dbHost || '?'}", bukan database lokal. Tambahkan --force bila memang disengaja.`);
  }

  const candidates = SIM_ASSETS.filter((a) => !a.unregistered);
  const registered = await prisma.asset.findMany({
    where: { hostname: { in: candidates.map((a) => a.hostname) }, isActive: true },
    select: { id: true, hostname: true },
  });
  const assetId = new Map(registered.map((a) => [a.hostname, a.id]));
  const missing = candidates.filter((a) => !assetId.has(a.hostname)).map((a) => a.hostname);
  if (assetId.size === 0) throw new Error('Aset contoh belum terdaftar. Jalankan "npm run seed" terlebih dahulu.');
  if (missing.length) console.log(`- Dilewati (belum terdaftar/nonaktif): ${missing.join(', ')}`);

  if (RESET) {
    const { count } = await prisma.backupRun.deleteMany({ where: { assetId: { in: [...assetId.values()] } } });
    console.log(`- ${count} riwayat backup lama dihapus.`);
  }

  const now = Date.now();
  const assets = candidates.filter((a) => assetId.has(a.hostname));
  const data = backupRunsBetween(now - DAYS * 24 * HOUR, now, assets).map(({ host, run }) => ({
    assetId: assetId.get(host.hostname)!,
    ...run,
    sizeBytes: BigInt(run.sizeBytes),
  }));
  const { count } = await prisma.backupRun.createMany({ data, skipDuplicates: true });

  console.log(`- ${count} riwayat backup baru disimpan (${data.length - count} sudah ada) untuk ${DAYS} hari terakhir.`);
  console.log('- Gagal: ' + assets.filter((a) => a.backup === 'failing').map((a) => a.hostname).join(', '));
  console.log('- Tanpa backup: ' + assets.filter((a) => a.backup === 'none').map((a) => a.hostname).join(', '));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
