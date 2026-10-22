import React, { useEffect, useState } from 'react';
import {
    Alert,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { isPlayerName, MAX_PLAYER_NAME_LENGTH } from 'common/playerName';
import { z } from 'zod';
import useDialogRequest from '../hooks/useDialogRequest';
import { readResponse } from '../utils/request';

const invitationSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.number() });
export default function PairDeviceDialog({
    gameId,
    open,
    onClose,
}: {
    gameId: string;
    open: boolean;
    onClose: () => void;
}) {
    const [name, setName] = useState('');
    const [role, setRole] = useState<'player' | 'spectator'>('player');
    const [link, setLink] = useState('');
    const [confirmRevoke, setConfirmRevoke] = useState(false);
    const [revoked, setRevoked] = useState(false);
    const { pending, error, run, cancel } = useDialogRequest(open);
    useEffect(() => {
        setLink('');
        setRevoked(false);
        setConfirmRevoke(false);
    }, [open, name, role]);
    const close = () => {
        cancel();
        onClose();
    };
    const create = () =>
        run(
            signal =>
                readResponse(
                    '/api/session/invite',
                    {
                        method: 'POST',
                        signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(role === 'player' ? { role, gameId, playerId: name } : { role, gameId }),
                    },
                    async response => {
                        if (!response.ok) throw new Error('Could not invite this device');
                        const data: unknown = await response.json();
                        return invitationSchema.parse(data);
                    },
                ),
            invitation => setLink(`${window.location.origin}/#pair=${invitation.token}`),
        );
    const revoke = () =>
        run(
            signal =>
                readResponse(
                    '/api/session/revoke',
                    {
                        method: 'POST',
                        signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ gameId }),
                    },
                    async response => {
                        if (!response.ok) throw new Error('Could not revoke access');
                        await response.json();
                    },
                ),
            () => {
                setConfirmRevoke(false);
                setLink('');
                setRevoked(true);
            },
        );
    return (
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
            <DialogTitle>Pair a device with game {gameId}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ pt: 1 }}>
                    <Typography>
                        Choose the person who will use this device. Give the invitation only to that person. It expires
                        after five minutes and works once.
                    </Typography>
                    <TextField
                        select
                        label="Device permission"
                        value={role}
                        disabled={pending}
                        onChange={event => setRole(event.target.value === 'spectator' ? 'spectator' : 'player')}
                    >
                        <MenuItem value="player">Player</MenuItem>
                        <MenuItem value="spectator">Spectator, read only</MenuItem>
                    </TextField>
                    {role === 'player' && (
                        <TextField
                            label="Player name"
                            value={name}
                            disabled={pending}
                            inputProps={{ maxLength: MAX_PLAYER_NAME_LENGTH }}
                            onChange={event => setName(event.target.value)}
                        />
                    )}
                    {role === 'player' && (
                        <Typography variant="body2">
                            Use an existing name to replace a lost device. Its previous access will be revoked. Assign
                            the player to a faction from the Players screen.
                        </Typography>
                    )}
                    {error && (
                        <Alert severity="error">
                            Could not update device access. Check the connection and try again.
                        </Alert>
                    )}
                    {revoked && (
                        <Alert severity="success">
                            All paired devices have been disconnected. Create new invitations for the people who should
                            rejoin.
                        </Alert>
                    )}
                    {link && (
                        <TextField
                            label="One-use invitation link"
                            value={link}
                            InputProps={{ readOnly: true }}
                            onFocus={event => event.target.select()}
                            helperText="This preview is local only. Pairing works in another browser on this PC. Wi-Fi sharing is being added separately."
                        />
                    )}
                    {confirmRevoke ? (
                        <Alert severity="warning">
                            Disconnect every paired player and spectator and cancel unused invitations? Saved games
                            remain on this PC.
                            <Button disabled={pending} onClick={() => setConfirmRevoke(false)}>
                                Keep devices connected
                            </Button>
                            <Button color="error" disabled={pending} onClick={revoke}>
                                Revoke device access
                            </Button>
                        </Alert>
                    ) : (
                        <Button color="error" disabled={pending} onClick={() => setConfirmRevoke(true)}>
                            Disconnect paired devices
                        </Button>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>Close</Button>
                <Button onClick={create} disabled={pending || (role === 'player' && !isPlayerName(name))}>
                    Create invitation
                </Button>
            </DialogActions>
        </Dialog>
    );
}
