/**
 * Daftar BPD dan host contoh, dipakai bersama oleh seed (Postgres) dan simulator (Elasticsearch)
 * agar hostname di dokumen Metricbeat cocok dengan aset yang terdaftar.
 * Semua nama adalah data contoh untuk development, bukan data produksi.
 */
export type Scenario = 'normal' | 'cpu-high' | 'memory-high' | 'disk-full' | 'disk-warning' | 'host-down' | 'error-logs';

export interface SimBpd {
  code: string;
  name: string;
  region: string;
}

export interface SimHost {
  hostname: string;
  ip: string;
  bpd: string;
  component: string;
  pic: string;
  scenario: Scenario;
  mounts: string[];
  /** Host yang sengaja tidak didaftarkan di seed (untuk menguji "unknown hosts") */
  unregistered?: boolean;
}

export const SIM_BPDS: SimBpd[] = [
  { code: 'BPD-JTG', name: 'BPD Jawa Tengah', region: 'Jawa Tengah' },
  { code: 'BPD-JTM', name: 'BPD Jawa Timur', region: 'Jawa Timur' },
  { code: 'BPD-BALI', name: 'BPD Bali', region: 'Bali' },
  { code: 'BPD-SUMUT', name: 'BPD Sumatera Utara', region: 'Sumatera Utara' },
];

export const SIM_HOSTS: SimHost[] = [
  { hostname: 'cbs-app-jtg-01', ip: '10.10.1.11', bpd: 'BPD-JTG', component: 'CORE_BANKING', pic: 'Tim Infrastruktur', scenario: 'normal', mounts: ['/', '/data'] },
  { hostname: 'cbs-db-jtg-01', ip: '10.10.1.21', bpd: 'BPD-JTG', component: 'DATABASE', pic: 'Tim DBA', scenario: 'disk-full', mounts: ['/', '/data'] },
  { hostname: 'cbs-app-jtm-01', ip: '10.20.1.11', bpd: 'BPD-JTM', component: 'CORE_BANKING', pic: 'Tim Infrastruktur', scenario: 'cpu-high', mounts: ['/', '/data'] },
  { hostname: 'cbs-db-jtm-01', ip: '10.20.1.21', bpd: 'BPD-JTM', component: 'DATABASE', pic: 'Tim DBA', scenario: 'normal', mounts: ['/', '/data'] },
  { hostname: 'web-ib-bali-01', ip: '10.30.1.31', bpd: 'BPD-BALI', component: 'WEB', pic: 'Tim Aplikasi', scenario: 'memory-high', mounts: ['/'] },
  { hostname: 'cbs-app-bali-01', ip: '10.30.1.11', bpd: 'BPD-BALI', component: 'CORE_BANKING', pic: 'Tim Infrastruktur', scenario: 'host-down', mounts: ['/', '/data'] },
  { hostname: 'mw-esb-sumut-01', ip: '10.40.1.41', bpd: 'BPD-SUMUT', component: 'MIDDLEWARE', pic: 'Tim Middleware', scenario: 'disk-warning', mounts: ['/', '/opt'] },
  { hostname: 'cbs-app-sumut-01', ip: '10.40.1.11', bpd: 'BPD-SUMUT', component: 'CORE_BANKING', pic: 'Tim Infrastruktur', scenario: 'error-logs', mounts: ['/', '/data'] },
  { hostname: 'test-unregistered-01', ip: '10.99.0.1', bpd: 'BPD-JTG', component: 'WEB', pic: '-', scenario: 'normal', mounts: ['/'], unregistered: true },
];

/** Menit sebelum "sekarang" saat host-down berhenti mengirim data. */
export const HOST_DOWN_MINUTES = 30;
