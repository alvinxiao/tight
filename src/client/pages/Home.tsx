import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Alert,
    Box,
    Button,
    Card,
    CardActions,
    CardContent,
    Container,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Stack,
    Typography,
} from '@mui/material';
import { SavedGameSummary } from 'common/savedGames';
import JoinGameDialog from '../components/JoinGameDialog';
import NewGameDialog from '../components/NewGameDialog';
import { deleteSavedGame, exportSavedGame, fetchSavedGames, importSavedGame } from '../utils/savedGames';

type SavedGames = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; games: SavedGameSummary[] };
type Notice = { severity: 'success' | 'error'; message: string } | null;

function Home() {
    const importInput = useRef<HTMLInputElement>(null);
    const [openCreateDialog, setOpenCreateDialog] = useState(false);
    const [openJoinDialog, setOpenJoinDialog] = useState(false);
    const [saved, setSaved] = useState<SavedGames>({ kind: 'loading' });
    const [notice, setNotice] = useState<Notice>(null);
    const [busy, setBusy] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);

    async function refresh(signal?: AbortSignal) {
        setNotice(null);
        setSaved({ kind: 'loading' });
        try {
            const games = await fetchSavedGames(signal);
            if (!signal?.aborted) setSaved({ kind: 'ready', games });
        } catch {
            if (!signal?.aborted) setSaved({ kind: 'error' });
        }
    }
    useEffect(() => {
        const controller = new AbortController();
        void refresh(controller.signal);
        return () => controller.abort();
    }, []);

    async function act(operation: () => Promise<string | void>) {
        setBusy(true);
        setNotice(null);
        try {
            const message = await operation();
            if (message) setNotice({ severity: 'success', message });
        } catch (error) {
            setNotice({
                severity: 'error',
                message: error instanceof Error ? error.message : 'Could not complete the action. Try again.',
            });
        } finally {
            setBusy(false);
            setDeleteId(null);
        }
    }

    return (
        <Container maxWidth="md" sx={{ py: 4 }}>
            <Typography variant="h4" component="h1" align="center" gutterBottom>
                TIGHT
            </Typography>
            <Typography align="center" gutterBottom>
                Twilight Imperium Game Helper / Tracker
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ my: 3 }}>
                <Button fullWidth variant="contained" size="large" onClick={() => setOpenCreateDialog(true)}>
                    Create Game
                </Button>
                <Button fullWidth variant="outlined" size="large" onClick={() => setOpenJoinDialog(true)}>
                    Join Game
                </Button>
            </Stack>
            <Box component="section" aria-labelledby="saved-games-heading">
                <Typography id="saved-games-heading" variant="h5" component="h2">
                    Saved games
                </Typography>
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                    Games saved on this host stay here when it restarts. Export a copy to keep a separate backup.
                </Typography>
                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                    <Button disabled={busy || saved.kind === 'loading'} onClick={() => void refresh()}>
                        Refresh saved games
                    </Button>
                    <Button onClick={() => importInput.current?.click()} disabled={busy || saved.kind === 'loading'}>
                        Import game
                    </Button>
                    <input
                        ref={importInput}
                        type="file"
                        accept=".json,application/json"
                        aria-label="Import game file"
                        hidden
                        disabled={busy || saved.kind === 'loading'}
                        onChange={event => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file)
                                void act(async () => {
                                    const id = await importSavedGame(file);
                                    await refresh();
                                    return `Imported game ${id}. Choose Resume to open it.`;
                                });
                        }}
                    />
                </Stack>
                {notice && (
                    <Alert severity={notice.severity} sx={{ mb: 2 }}>
                        {notice.message}
                    </Alert>
                )}
                {busy && <Typography role="status">Working…</Typography>}
                {saved.kind === 'loading' && <Typography role="status">Loading saved games…</Typography>}
                {saved.kind === 'error' && (
                    <Alert
                        severity="error"
                        action={
                            <Button color="inherit" onClick={() => void refresh()}>
                                Retry
                            </Button>
                        }
                    >
                        Could not load saved games. Check the host connection and try again.
                    </Alert>
                )}
                {saved.kind === 'ready' && saved.games.length === 0 && (
                    <Typography>No saved games yet. Create a game or import an exported copy.</Typography>
                )}
                {saved.kind === 'ready' && (
                    <Stack spacing={2}>
                        {saved.games.map(game => (
                            <Card key={game.id} component="article" aria-label={`Saved game ${game.id}`}>
                                <CardContent>
                                    <Typography component="h3" variant="h6">
                                        {game.id}
                                    </Typography>
                                    <Typography>
                                        {game.state === 'finished'
                                            ? 'Finished'
                                            : game.state === 'playing'
                                              ? 'In progress'
                                              : 'Setting up'}{' '}
                                        · Round {game.round} of {game.numRounds}
                                    </Typography>
                                    <Typography sx={{ overflowWrap: 'anywhere' }}>
                                        {game.players.length ? game.players.join(', ') : 'No players yet'}
                                    </Typography>
                                    <Typography color="text.secondary">
                                        Created {new Date(game.date).toLocaleString()}
                                    </Typography>
                                </CardContent>
                                <CardActions sx={{ flexWrap: 'wrap' }}>
                                    <Button
                                        component={Link}
                                        to={`/${game.id}`}
                                        disabled={busy}
                                        aria-label={`Resume ${game.id}`}
                                    >
                                        Resume
                                    </Button>
                                    <Button
                                        disabled={busy}
                                        aria-label={`Export ${game.id}`}
                                        onClick={() => void act(() => exportSavedGame(game.id))}
                                    >
                                        Export
                                    </Button>
                                    <Button
                                        color="error"
                                        disabled={busy}
                                        aria-label={`Delete ${game.id}`}
                                        onClick={() => setDeleteId(game.id)}
                                    >
                                        Delete
                                    </Button>
                                </CardActions>
                            </Card>
                        ))}
                    </Stack>
                )}
            </Box>
            <Dialog
                open={deleteId !== null}
                onClose={() => {
                    if (!busy) setDeleteId(null);
                }}
                aria-labelledby="delete-game-title"
            >
                <DialogTitle id="delete-game-title">Delete saved game {deleteId}?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        This removes the game from this host and disconnects its players. Export a copy first if you
                        want to keep it.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button disabled={busy} onClick={() => setDeleteId(null)}>
                        Cancel
                    </Button>
                    <Button
                        color="error"
                        disabled={busy}
                        onClick={() => {
                            if (deleteId)
                                void act(async () => {
                                    await deleteSavedGame(deleteId);
                                    await refresh();
                                    return `Deleted game ${deleteId}.`;
                                });
                        }}
                    >
                        Delete saved game
                    </Button>
                </DialogActions>
            </Dialog>
            {openCreateDialog && <NewGameDialog open={openCreateDialog} onClose={() => setOpenCreateDialog(false)} />}
            {openJoinDialog && <JoinGameDialog open={openJoinDialog} onClose={() => setOpenJoinDialog(false)} />}
        </Container>
    );
}
export default Home;
