import 'dotenv/config';
import { AssetCategory, LifecycleCategory, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { SIM_HOSTS, SIM_ASSETS } from '../scripts/sim-hosts';

const prisma = new PrismaClient();
const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);

/** Role sistem (ADMIN, SUPERVISOR, OPERATOR, MANAGEMENT, AUDITOR) dibuat oleh migrasi `dynamic_roles`. */
async function seedUser(username: string, password: string, fullName: string, roleCode: string) {
  if (await prisma.user.findUnique({ where: { username } })) {
    console.log(`- User "${username}" sudah ada, dilewati.`);
    return;
  }
  const role = await prisma.accessRole.findUnique({ where: { code: roleCode } });
  if (!role) throw new Error(`Role ${roleCode} tidak ada. Jalankan "npx prisma migrate deploy" terlebih dahulu.`);
  await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash(password, rounds), fullName, roleId: role.id } });
  console.log(`- User "${username}" (${roleCode}) dibuat.`);
}

async function seedAdmin() {
  const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD wajib diisi di .env (minimal 8 karakter).');
  }
  await seedUser(username, password, process.env.SEED_ADMIN_FULLNAME ?? 'Administrator SYNRA', 'ADMIN');
}

/** User contoh per role, hanya bila SEED_DEMO_PASSWORD diisi (untuk development/uji FE). */
async function seedDemoUsers() {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) return;
  await seedUser('supervisor', password, 'Supervisor NOC', 'SUPERVISOR');
  await seedUser('operator', password, 'Operator NOC', 'OPERATOR');
  await seedUser('manajemen', password, 'Manajemen TI', 'MANAGEMENT');
  await seedUser('auditor', password, 'Auditor Internal', 'AUDITOR');
}

/** Host dan aset contoh yang cocok dengan host di simulator. */
async function seedSampleAssets() {
  if (process.env.SEED_SAMPLE_ASSETS === 'false') return;
  for (const b of SIM_HOSTS) {
    await prisma.host.upsert({ where: { code: b.code }, create: b, update: {} });
  }
  const hosts = new Map((await prisma.host.findMany()).map((b) => [b.code, b.id]));
  const classification = { category: AssetCategory.SOFTWARE, type: 'VM' };
  let created = 0;
  let classified = 0;
  for (const h of SIM_ASSETS.filter((x) => !x.unregistered)) {
    const exists = await prisma.asset.findUnique({ where: { hostname: h.hostname } });
    if (exists) {
      // Aset contoh dari seed lama belum punya klasifikasi; nilai yang sudah diisi user tidak ditimpa.
      const { count } = await prisma.asset.updateMany({
        where: { hostname: h.hostname, category: null, type: null },
        data: classification,
      });
      classified += count;
      continue;
    }
    await prisma.asset.create({
      data: { hostname: h.hostname, ipAddress: h.ip, component: h.component, hostId: hosts.get(h.host)!, ...classification, picName: h.pic },
    });
    created++;
  }
  console.log(`- ${SIM_HOSTS.length} host dan ${created} aset contoh disiapkan, ${classified} aset lama diklasifikasikan.`);
}

/** Item siklus hidup contoh. Tanggal berakhir relatif terhadap hari ini supaya semua tingkat urgensi terlihat. */
async function seedSampleLifecycle() {
  if (process.env.SEED_SAMPLE_ASSETS === 'false') return;
  const inDays = (n: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };
  const items: { code: string; name: string; category: LifecycleCategory; days: number; quantity?: number; allocated?: number; picName: string; vendor?: string }[] = [
    { code: 'OS-001', name: 'Windows Server 2012 R2 (end of support)', category: 'OS', days: -20, quantity: 2, allocated: 2, picName: 'Tim Infrastruktur', vendor: 'Microsoft' },
    { code: 'OS-002', name: 'Red Hat Enterprise Linux 7 (extended support)', category: 'OS', days: 200, quantity: 6, allocated: 6, picName: 'Tim Infrastruktur', vendor: 'Red Hat' },
    { code: 'LIC-001', name: 'VMware vSphere Enterprise', category: 'LICENSE', days: 12, quantity: 20, allocated: 20, picName: 'Tim Asset Management', vendor: 'Broadcom' },
    { code: 'LIC-002', name: 'Oracle Database Enterprise', category: 'LICENSE', days: 50, quantity: 8, allocated: 7, picName: 'Tim DBA', vendor: 'Oracle' },
    { code: 'LIC-003', name: 'Antivirus Endpoint', category: 'LICENSE', days: 300, quantity: 1000, allocated: 985, picName: 'Tim Security' },
    { code: 'CRT-001', name: 'SSL internet banking', category: 'CERTIFICATE', days: 25, picName: 'Tim Security' },
    { code: 'CRT-002', name: 'SSL API gateway', category: 'CERTIFICATE', days: 140, picName: 'Tim Security' },
    { code: 'WAR-001', name: 'Garansi SAN storage utama', category: 'WARRANTY', days: 80, picName: 'Tim Infrastruktur' },
    { code: 'CON-001', name: 'Kontrak pemeliharaan data center', category: 'CONTRACT', days: 400, picName: 'Tim Pengadaan' },
  ];
  let created = 0;
  for (const { days, ...item } of items) {
    const exists = await prisma.lifecycleItem.findUnique({ where: { code: item.code } });
    if (exists) continue;
    await prisma.lifecycleItem.create({ data: { ...item, expiryDate: inDays(days), location: 'DC utama' } });
    created++;
  }
  console.log(`- ${created} item siklus hidup contoh dibuat.`);
}

async function main() {
  console.log('Seeding database SYNRA...');
  await seedAdmin();
  await seedDemoUsers();
  await seedSampleAssets();
  await seedSampleLifecycle();
  console.log('Selesai. Aturan threshold default dibuat otomatis saat backend start.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
