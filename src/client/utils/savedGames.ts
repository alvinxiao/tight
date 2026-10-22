import { savedGameListSchema } from 'common/savedGames';
import { isGameCode } from 'common/gameCode';
import { getApiUrl } from './urls';

async function checked(response: Response): Promise<Response> {
    if (response.ok) return response;
    if (response.status === 409)
        throw new Error('A game with this code already exists. Your saved game has not been replaced.');
    if (response.status === 400) throw new Error('This file is not a supported TIGHT game export.');
    if (response.status === 413) throw new Error('The game file is too large. Choose an export smaller than 1 MiB.');
    if (response.status === 404) throw new Error('This game is no longer on the host. Refresh the saved-game list.');
    if (response.status === 503)
        throw new Error('The host could not save the change. Check its storage and try again.');
    throw new Error('Could not reach the host. Check the connection and try again.');
}
async function request(url: string, options?: RequestInit): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(url, options);
    } catch {
        throw new Error('Could not reach the host. Check the connection and try again.');
    }
    return checked(response);
}

function url(operation: string) {
    return getApiUrl(window.location.origin, `/game/${operation}`);
}

export async function fetchSavedGames(signal?: AbortSignal) {
    const response = await request(url('list'), { signal });
    const data: unknown = await response.json();
    return savedGameListSchema.parse(data);
}
export async function importSavedGame(file: File) {
    if (file.size > 1024 * 1024) throw new Error('The game file is too large. Choose an export smaller than 1 MiB.');
    const response = await request(url('import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await file.text(),
    });
    const id: unknown = await response.json();
    if (!isGameCode(id))
        throw new Error('The host returned an invalid game code. Refresh the list before trying again.');
    return id;
}
export async function deleteSavedGame(id: string) {
    await request(url('delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
    });
}
export async function exportSavedGame(id: string) {
    const response = await request(`${url('export')}?gameId=${encodeURIComponent(id)}`);
    const download = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = download;
    anchor.download = `tight-${id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(download), 1000);
}
