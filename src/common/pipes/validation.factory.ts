import { BadRequestException, ValidationError } from '@nestjs/common';
import { MSG } from '../constants/messages';

/** Pesan fallback bila DTO tidak menyediakan pesan sendiri. */
const FALLBACK: Record<string, (field: string) => string> = {
  whitelistValidation: (f) => `Field "${f}" tidak dikenal.`,
  isNotEmpty: (f) => `${f} wajib diisi.`,
  isDefined: (f) => `${f} wajib diisi.`,
  isString: (f) => `${f} harus berupa teks.`,
  isInt: (f) => `${f} harus berupa bilangan bulat.`,
  isNumber: (f) => `${f} harus berupa angka.`,
  isBoolean: (f) => `${f} harus bernilai true atau false.`,
  isEnum: (f) => `Nilai ${f} tidak valid.`,
  isUUID: (f) => `${f} harus berupa UUID yang valid.`,
  isDateString: (f) => `${f} harus berupa tanggal ISO 8601.`,
  isISO8601: (f) => `${f} harus berupa tanggal ISO 8601.`,
  isIP: (f) => `${f} harus berupa alamat IP yang valid.`,
  min: (f) => `${f} terlalu kecil.`,
  max: (f) => `${f} terlalu besar.`,
  minLength: (f) => `${f} terlalu pendek.`,
  maxLength: (f) => `${f} terlalu panjang.`,
};

/**
 * Satu pesan per field, dipilih menurut prioritas: field kosong dilaporkan sebagai "wajib diisi",
 * bukan pelanggaran panjang/format yang ikut gagal karena nilainya undefined.
 */
const PRIORITY = [
  'whitelistValidation',
  'isDefined',
  'isNotEmpty',
  'isString',
  'isNumber',
  'isInt',
  'isBoolean',
  'isArray',
  'isEnum',
  'isUUID',
  'isIP',
  'isISO8601',
  'isDateString',
];

function pickConstraint(constraints: Record<string, string>): [string, string] {
  const entries = Object.entries(constraints);
  for (const key of PRIORITY) {
    const hit = entries.find(([k]) => k === key);
    if (hit) return hit;
  }
  return entries[0];
}

function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((err) => {
    const field = parent ? `${parent}.${err.property}` : err.property;
    const own: string[] = [];
    if (err.constraints && Object.keys(err.constraints).length) {
      const [key, message] = pickConstraint(err.constraints);
      // class-validator memakai pesan bawaan berbahasa Inggris bila DTO tidak memberi pesan.
      const isDefaultEnglish = /^(property |each value |\w+ (must|should))/i.test(message);
      own.push(isDefaultEnglish && FALLBACK[key] ? FALLBACK[key](field) : message);
    }
    return [...own, ...flatten(err.children ?? [], field)];
  });
}

export function validationExceptionFactory(errors: ValidationError[]) {
  return new BadRequestException({ message: MSG.VALIDATION_FAILED, errors: flatten(errors) });
}
