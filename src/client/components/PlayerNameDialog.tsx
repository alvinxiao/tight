import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CloseIcon from '@mui/icons-material/Close';
import {
    AppBar,
    Alert,
    Button,
    CircularProgress,
    Dialog,
    DialogContent,
    FormControl,
    Grid,
    IconButton,
    MenuItem,
    SxProps,
    TextField,
    TextFieldProps,
    Theme,
    Toolbar,
    Tooltip,
    Typography,
} from '@mui/material';

import { isPlayerName, MAX_PLAYER_NAME_LENGTH } from 'common/playerName';
import { MessageType } from 'common/message';

import useGameInfo from '../hooks/useGameInfo';

import { useAppContext } from '../Context';
import { ActionType } from '../reducer';

import GameInfoToolbar from './GameInfoToolbar';

const styles: Record<string, SxProps<Theme>> = {
    appBar: {
        flexDirection: 'row',
        position: 'relative',
        alignItems: 'center',
        paddingRight: 2,
    },
    title: {
        marginLeft: 2,
        flex: 1,
    },
    gridItem: {
        width: '100%',
    },
    joinButton: {
        marginTop: 2,
    },
};

const CREATE_NEW_PLAYER_VALUE = 'Create New Player';

interface PlayerNameDialogProps {
    open: boolean;
    onClose?: (canceled: boolean) => void;
}

export default function PlayerNameDialog(props: PlayerNameDialogProps) {
    const { open, onClose } = props;

    const { sendData, dispatch } = useAppContext();
    const { game, gameId, playerId } = useGameInfo();

    const [isNewPlayer, setIsNewPlayer] = useState(!Boolean(playerId));
    const [selectedPlayerId, setSelectedPlayerId] = useState(playerId ?? '');
    const [joining, setJoining] = useState(false);
    const [joinError, setJoinError] = useState(false);

    const navigate = useNavigate();

    useEffect(() => {
        if (joining && game?.players.includes(selectedPlayerId)) {
            setJoining(false);
            onClose?.(false);
            dispatch({ type: ActionType.setPlayerId, payload: selectedPlayerId });
            navigate(`/${gameId}/status`);
        }
    }, [game, joining, selectedPlayerId]);

    useEffect(() => {
        if (!open) {
            setJoining(false);
            setJoinError(false);
        }
        if (!open || !joining) return;
        const timer = setTimeout(() => {
            setJoining(false);
            setJoinError(true);
        }, 15000);
        return () => clearTimeout(timer);
    }, [open, joining]);

    if (!game) {
        return null;
    }

    const onJoinClick = (e: React.SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!gameId) {
            return;
        }

        setJoinError(false);
        const sent = sendData({
            type: MessageType.GAME_ADD_PLAYER,
            data: { gameId, playerId: selectedPlayerId },
        });

        setJoining(sent);
        setJoinError(!sent);
    };

    const onCancel = () => {
        setJoining(false);
        onClose?.(true);
    };

    const onPlayerNameChange: TextFieldProps['onChange'] = e => {
        const newName = e.target.value;
        setSelectedPlayerId(newName);
        setIsNewPlayer(newName === CREATE_NEW_PLAYER_VALUE);
    };

    return (
        <Dialog open={open} fullScreen>
            <AppBar sx={styles.appBar}>
                <Toolbar>
                    <Tooltip title="Close">
                        <IconButton onClick={onCancel} size="large">
                            <CloseIcon />
                        </IconButton>
                    </Tooltip>
                </Toolbar>
                <Toolbar>
                    <Typography variant="h6" sx={styles.title}>
                        Player
                    </Typography>
                </Toolbar>
            </AppBar>
            <DialogContent dividers>
                {joinError && (
                    <Alert severity="error">
                        Could not confirm your player joined. Check the connection and try again.
                    </Alert>
                )}
                <GameInfoToolbar game={game} sx={{ marginBottom: 1 }} hideRestartButton hidePairButton />
                <Grid container direction="column" justifyContent="center" alignItems="center" spacing={2}>
                    <Grid item sx={styles.gridItem}>
                        <FormControl fullWidth variant="standard">
                            <TextField
                                label="Select Player"
                                select
                                value={
                                    game.players.includes(selectedPlayerId) ? selectedPlayerId : CREATE_NEW_PLAYER_VALUE
                                }
                                fullWidth
                                variant="outlined"
                                onChange={onPlayerNameChange}
                            >
                                <MenuItem key={CREATE_NEW_PLAYER_VALUE} value={CREATE_NEW_PLAYER_VALUE} divider>
                                    Create New Player
                                </MenuItem>
                                {game.players.map(playerId => (
                                    <MenuItem key={playerId} value={playerId}>
                                        {playerId}
                                    </MenuItem>
                                ))}
                            </TextField>
                        </FormControl>
                    </Grid>
                    {isNewPlayer && (
                        <Grid item sx={styles.gridItem}>
                            <FormControl fullWidth variant="standard">
                                <TextField
                                    color="primary"
                                    variant="outlined"
                                    label="Enter Name"
                                    inputProps={{ maxLength: MAX_PLAYER_NAME_LENGTH }}
                                    error={Boolean(selectedPlayerId) && !isPlayerName(selectedPlayerId)}
                                    helperText={
                                        selectedPlayerId && !isPlayerName(selectedPlayerId)
                                            ? 'Choose a different name, up to 80 characters.'
                                            : ''
                                    }
                                    onChange={e => setSelectedPlayerId(e.target.value)}
                                />
                            </FormControl>
                        </Grid>
                    )}
                    <Grid item sx={styles.gridItem}>
                        <FormControl fullWidth variant="standard">
                            <Button
                                disabled={!isPlayerName(selectedPlayerId) || joining}
                                sx={styles.joinButton}
                                color="primary"
                                variant="contained"
                                size="large"
                                onClick={onJoinClick}
                            >
                                {joining ? <CircularProgress size={24} /> : 'Continue'}
                            </Button>
                        </FormControl>
                    </Grid>
                </Grid>
            </DialogContent>
        </Dialog>
    );
}
