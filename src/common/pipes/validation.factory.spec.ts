import { BadRequestException, ValidationError } from '@nestjs/common';
import { validationExceptionFactory } from './validation.factory';

function errorsOf(errors: ValidationError[]): string[] {
  const ex = validationExceptionFactory(errors) as BadRequestException;
  return (ex.getResponse() as { errors: string[] }).errors;
}

describe('validationExceptionFactory', () => {
  it('field kosong dilaporkan sebagai wajib diisi, bukan batas panjang', () => {
    expect(
      errorsOf([
        {
          property: 'note',
          constraints: {
            maxLength: 'Catatan maksimal 2000 karakter.',
            isNotEmpty: 'Catatan wajib diisi.',
            isString: 'Catatan harus berupa teks.',
          },
        },
      ]),
    ).toEqual(['Catatan wajib diisi.']);
  });

  it('satu pesan per field', () => {
    expect(
      errorsOf([
        { property: 'a', constraints: { isString: 'A teks.', minLength: 'A pendek.' } },
        { property: 'b', constraints: { min: 'B kecil.' } },
      ]),
    ).toEqual(['A teks.', 'B kecil.']);
  });

  it('pesan bawaan Inggris diganti dengan Bahasa Indonesia', () => {
    expect(errorsOf([{ property: 'foo', constraints: { whitelistValidation: 'property foo should not exist' } }])).toEqual([
      'Field "foo" tidak dikenal.',
    ]);
  });

  it('menelusuri field bersarang', () => {
    expect(
      errorsOf([
        {
          property: 'levels',
          children: [{ property: '0', children: [{ property: 'value', constraints: { isNumber: 'value must be a number' } }] }],
        },
      ]),
    ).toEqual(['levels.0.value harus berupa angka.']);
  });
});
