import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { MessageType } from '../../src/common/message.js';

for (const switching of [false, true]) {
    test(`a failed game load ${switching ? 'while switching saved games' : 'from the home screen'} recovers the requested game`, async ({ page, request }) => {
        await page.addInitScript(loadType => {
            const NativeWebSocket = window.WebSocket;
            const connections: string[] = [];
            Reflect.set(window, 'loadConnections', connections);
            let failedSocket: WebSocket | null = null;
            window.WebSocket = class extends NativeWebSocket {
                constructor(url: string | URL, protocols?: string | string[]) {
                    super(url, protocols);
                    connections.push(String(url));
                    const send = this.send.bind(this);
                    const close = this.close.bind(this);
                    this.send = data => {
                        if (typeof data === 'string' && Reflect.get(window, 'loadFaultArmed')) {
                            const packet: unknown = JSON.parse(data);
                            if (packet && typeof packet === 'object' && 'type' in packet && packet.type === loadType) {
                                Reflect.set(window, 'loadFaultArmed', false);
                                Reflect.set(window, 'loadFaultUsed', true);
                                failedSocket = this;
                                throw new DOMException('Simulated game load transport failure', 'InvalidStateError');
                            }
                        }
                        send(data);
                    };
                    this.close = (code, reason) => {
                        if (this === failedSocket) {
                            Reflect.set(window, 'loadCloseHeld', true);
                            return;
                        }
                        close(code, reason);
                    };
                }
            };
        }, MessageType.GAME_LOAD);
        const codes: string[] = [];
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            for (let index = 0; index < (switching ? 2 : 1); index += 1) {
                const created = await request.post('/api/game/create', { data: { numPlayers: index + 1 } });
                expect(created.ok()).toBe(true);
                const code: unknown = await created.json();
                if (typeof code !== 'string') throw new Error('Expected game code');
                codes.push(code);
            }
            if (switching) {
                await page.goto(`/${codes[0]}/players`);
                await expect(page.getByRole('combobox', { name: /^Faction /u })).toHaveCount(1);
                await page.getByRole('button', { name: 'Menu', exact: true }).click();
                await page.getByRole('button', { name: 'Home', exact: true }).click();
            } else await page.goto('/');
            const target = codes[codes.length - 1];
            const resume = page.getByRole('link', { name: `Resume ${target}`, exact: true });
            await expect(resume).toBeVisible();
            await page.clock.install();
            await page.evaluate(() => Reflect.set(window, 'loadFaultArmed', true));
            await resume.click();
            await expect.poll(() => page.evaluate(() => Reflect.get(window, 'loadFaultUsed'))).toBe(true);
            await page.clock.fastForward(3001);
            await expect.poll(() => page.evaluate(() => Reflect.get(window, 'loadConnections').length)).toBe(2);
            const endpoint: unknown = await page.evaluate(() => Reflect.get(window, 'loadConnections')[1]);
            if (typeof endpoint !== 'string') throw new Error('Expected replacement socket URL');
            expect(new URL(endpoint).searchParams.get('gameId')).toBe(target);
            await expect(page.getByRole('textbox', { name: 'Enter Name', exact: true })).toBeVisible();
            expect(await page.evaluate(() => Reflect.get(window, 'loadCloseHeld'))).toBe(true);
            await page.getByRole('textbox', { name: 'Enter Name', exact: true }).fill('Recovered game host');
            await page.getByRole('button', { name: 'Continue', exact: true }).click();
            await expect(page.getByRole('combobox', { name: /^Faction /u })).toHaveCount(switching ? 2 : 1);
            await expect(page).toHaveURL(new RegExp(`/${target}(?:/status)?$`));
            await expect(page.getByRole('status')).toHaveText('Saved');
            const savedPlayers = z.object({ game: z.object({ players: z.record(z.string(), z.unknown()) }) });
            const saved = savedPlayers.parse(await (await request.get(`/api/game/export?gameId=${target}`)).json());
            expect(Object.keys(saved.game.players)).toEqual(['Recovered game host']);
            if (switching) {
                const previous = savedPlayers.parse(await (await request.get(`/api/game/export?gameId=${codes[0]}`)).json());
                expect(Object.keys(previous.game.players)).toEqual([]);
            }
            await page.clock.fastForward(30000);
            expect(await page.evaluate(() => Reflect.get(window, 'loadConnections').length)).toBe(2);
            expect(errors).toEqual([]);
        } finally {
            for (const id of codes) await request.post('/api/game/delete', { data: { id } });
        }
    });
}
