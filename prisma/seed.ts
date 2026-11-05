import 'dotenv/config';
import { AssetCategory, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { SIM_HOSTS, SIM_ASSETS } from '../scripts/sim-hosts';

const prisma = new PrismaClient();
const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);

async function seedUser(username: string, password: string, fullName: string, role: Role) {
  if (await prisma.user.findUnique({ where: { username } })) {
    console.log(`- User "${username}" sudah ada, dilewati.`);
    return;
  }
  await prisma.user.create({ data: { username, passwordHash: await bcrypt.hash(password, rounds), fullName, role } });
  console.log(`- User "${username}" (${role}) dibuat.`);
}

async function seedAdmin() {
  const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD wajib diisi di .env (minimal 8 karakter).');
  }
  await seedUser(username, password, process.env.SEED_ADMIN_FULLNAME ?? 'Administrator SYNRA', Role.ADMIN);
}

/** User contoh per role, hanya bila SEED_DEMO_PASSWORD diisi (untuk development/uji FE). */
async function seedDemoUsers() {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) return;
  await seedUser('supervisor', password, 'Supervisor NOC', Role.SUPERVISOR);
  await seedUser('operator', password, 'Operator NOC', Role.OPERATOR);
  await seedUser('manajemen', password, 'Manajemen TI', Role.MANAGEMENT);
  await seedUser('auditor', password, 'Auditor Internal', Role.AUDITOR);
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

async function main() {
  console.log('Seeding database SYNRA...');
  await seedAdmin();
  await seedDemoUsers();
  await seedSampleAssets();
  console.log('Selesai. Aturan threshold default dibuat otomatis saat backend start.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
