import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { SIM_BPDS, SIM_HOSTS } from '../scripts/sim-hosts';

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
  await seedUser('operator', password, 'Operator NOC', Role.OPERATOR);
  await seedUser('manajemen', password, 'Manajemen TI', Role.MANAGEMENT);
  await seedUser('auditor', password, 'Auditor Internal', Role.AUDITOR);
}

/** BPD dan aset contoh yang cocok dengan host di simulator. */
async function seedSampleAssets() {
  if (process.env.SEED_SAMPLE_ASSETS === 'false') return;
  for (const b of SIM_BPDS) {
    await prisma.bpd.upsert({ where: { code: b.code }, create: b, update: {} });
  }
  const bpds = new Map((await prisma.bpd.findMany()).map((b) => [b.code, b.id]));
  let created = 0;
  for (const h of SIM_HOSTS.filter((x) => !x.unregistered)) {
    const exists = await prisma.asset.findUnique({ where: { hostname: h.hostname } });
    if (exists) continue;
    await prisma.asset.create({
      data: { hostname: h.hostname, ipAddress: h.ip, component: h.component, bpdId: bpds.get(h.bpd)!, picName: h.pic },
    });
    created++;
  }
  console.log(`- ${SIM_BPDS.length} BPD dan ${created} aset contoh disiapkan.`);
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
