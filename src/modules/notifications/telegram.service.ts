import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendResult = { ok: true } | { ok: false; skipped: boolean; error: string };

const MAX_ATTEMPTS = 3;

/** Pengirim pesan Telegram Bot API dengan retry (termasuk menghormati retry_after saat 429). */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token?: string;
  private readonly chatId?: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
    this.chatId = config.get<string>('TELEGRAM_CHAT_ID') || undefined;
  }

  get configured(): boolean {
    return Boolean(this.token && this.chatId);
  }

  /** chatId opsional untuk mengirim ke chat lain selain grup utama (mis. chat tingkat eskalasi). */
  async send(html: string, chatId?: string | null): Promise<SendResult> {
    const target = chatId || this.chatId;
    if (!this.token || !target) {
      return { ok: false, skipped: true, error: 'Telegram belum dikonfigurasi' };
    }
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: target,
            text: html,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          description?: string;
          parameters?: { retry_after?: number };
        };
        if (res.ok && body.ok) return { ok: true };

        lastError = body.description ?? `HTTP ${res.status}`;
        // 4xx selain 429 tidak akan berhasil bila diulang (token/chat salah).
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        const wait = (body.parameters?.retry_after ?? attempt) * 1000;
        if (attempt < MAX_ATTEMPTS) await sleep(Math.min(wait, 30_000));
      } catch (e) {
        lastError = (e as Error).message;
        if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000);
      }
    }
    this.logger.warn(`Gagal mengirim Telegram: ${lastError}`);
    return { ok: false, skipped: false, error: lastError };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
