import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CloseIcon from '@mui/icons-material/Close';
import {
    AppBar,
    Button,
    CircularProgress,
    Dialog,
    DialogContent,
    FormControl,
    Grid,
    IconButton,
    SxProps,
    TextField,
    Theme,
    Toolbar,
    Tooltip,
    Typography,
} from '@mui/material';

import { useAppContext } from '../Context';
import useGameInfo from '../hooks/useGameInfo';
import { ActionType } from '../reducer';
import api from '../utils/api';
import useDialogRequest from '../hooks/useDialogRequest';
import { isGameCode } from 'common/gameCode';

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

interface JoinGameDialogProps {
    open: boolean;
    onClose: () => void;
}

export default function JoinGameDialog(props: JoinGameDialogProps) {
    const { open, onClose } = props;
    const { gameId: currentGameId } = useGameInfo();
    const { dispatch } = useAppContext();

    const [gameId, setGameId] = useState('');
    const [invalid, setInvalid] = useState(false);
    const { pending: joining, error: networkError, run, cancel } = useDialogRequest(open);
    const error = invalid ? 'invalid' : networkError ? 'network' : null;
    const [canRejoin, setCanRejoin] = useState(true);

    const navigate = useNavigate();

    const onCancel = () => {
        cancel();
        onClose();
    };

    const onJoinClick = (e: React.SyntheticEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isGameCode(id)) {
            setInvalid(true);
            return;
        }
        setInvalid(false);

        void run(
            signal => api.gameValidate({ gameId: id }, { signal }),
            exists => {
                if (exists) {
                    navigate(`/${id}`);
                } else {
                    if (id === currentGameId) {
                        setCanRejoin(false);
                    }

                    if (id === gameId) {
                        setInvalid(true);
                    }
                }
            },
        );
    };

    return (
        <Dialog PaperProps={{ 'aria-label': 'Join game' }} open={open} onClose={onCancel} fullScreen>
            <AppBar sx={styles.appBar}>
                <Toolbar>
                    <Tooltip title="Close">
                        <IconButton onClick={onCancel} size="large">
                            <CloseIcon />
                        </IconButton>
                    </Tooltip>
                </Toolbar>
                <Typography variant="h6" sx={styles.title}>
                    Join Game
                </Typography>
            </AppBar>
            <DialogContent dividers>
                <Grid container direction="column" justifyContent="center" alignItems="center" spacing={2}>
                    <Grid item sx={styles.gridItem}>
                        <FormControl fullWidth variant="standard">
                            <TextField
                                color="primary"
                                variant="outlined"
                                label="Game Code"
                                helperText={
                                    error === 'invalid'
                                        ? 'Invalid Game Code'
                                        : error === 'network'
                                          ? 'Could not reach the host. Try again.'
                                          : ''
                                }
                                error={Boolean(error)}
                                onChange={e => setGameId(e.target.value.toUpperCase())}
                                value={gameId}
                            />
                        </FormControl>
                    </Grid>
                    <Grid item sx={styles.gridItem}>
                        <FormControl fullWidth variant="standard">
                            <Button
                                aria-label="Join"
                                disabled={gameId.length !== 4 || joining}
                                sx={styles.joinButton}
                                color="primary"
                                variant="contained"
                                size="large"
                                onClick={e => onJoinClick(e, gameId)}
                            >
                                {joining ? <CircularProgress aria-label="Joining game" size={24} /> : 'Join'}
                            </Button>
                        </FormControl>
                    </Grid>
                    {currentGameId && canRejoin && (
                        <>
                            <Grid item sx={styles.gridItem}>
                                <FormControl fullWidth variant="standard">
                                    <Button
                                        aria-label={`Rejoin "${currentGameId}"}`}
                                        disabled={joining}
                                        sx={styles.joinButton}
                                        color="primary"
                                        variant="contained"
                                        size="large"
                                        onClick={e => onJoinClick(e, currentGameId)}
                                    >
                                        {joining ? <CircularProgress aria-label="Joining game" size={24} /> : `Rejoin "${currentGameId}"`}
                                    </Button>
                                </FormControl>
                            </Grid>
                            <Grid item sx={styles.gridItem}>
                                <FormControl fullWidth variant="standard">
                                    <Button
                                        aria-label={`Rejoin "${currentGameId}" as new player`}
                                        disabled={joining}
                                        sx={styles.joinButton}
                                        color="primary"
                                        variant="contained"
                                        size="large"
                                        onClick={e => {
                                            dispatch({ type: ActionType.setPlayerId, payload: undefined });
                                            onJoinClick(e, currentGameId);
                                        }}
                                    >
                                        {joining ? (
                                            <CircularProgress aria-label="Joining game" size={24} />
                                        ) : (
                                            `Rejoin "${currentGameId}" as new player`
                                        )}
                                    </Button>
                                </FormControl>
                            </Grid>
                        </>
                    )}
                </Grid>
            </DialogContent>
        </Dialog>
    );
}
