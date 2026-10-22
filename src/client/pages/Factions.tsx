import React, { useCallback, useState } from 'react';

import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { AppBar, Button, CircularProgress, Grid, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import { makeStyles } from '@mui/styles';


import FactionInfo, { FactionAccordionIndex, FactionInfoProps } from '../components/FactionInfo';
import FactionSelect from '../components/FactionSelect';
import api from '../utils/api';
import useRemoteData from '../hooks/useRemoteData';
import LoadFailure from '../components/LoadFailure';

import { HEADER_HEIGHT } from '../constants';

// Num accordions
const COUNT = Object.keys(FactionAccordionIndex).length;

const useStyles = makeStyles(theme => ({
    appBar: {
        top: HEADER_HEIGHT,
    },
    toolbar: {
        width: '100%',
        margin: `${theme.spacing(1)} 0px`,
    },
}));

function Factions() {
    const classes = useStyles();

    const [selectedName, setSelectedName] = useState('');
    const load = useCallback(async (signal: AbortSignal) => {
        const names = await api.factionListNames(undefined, { signal });
        const name = selectedName || names[0];
        const [faction] = await api.factionGetFaction({ name }, { signal });
        if (!faction) throw new Error('Faction not found');
        return { names, faction, name };
    }, [selectedName]);
    const { resource, retry } = useRemoteData(load);
    const pending = resource.kind === 'loading';
    const factionInfo = resource.kind === 'loaded' ? resource.data.faction : null;
    const factionNames = resource.kind === 'loaded' ? resource.data.names : [];
    const displayName = resource.kind === 'loaded' ? resource.data.name : selectedName;

    const [expanded, setExpanded] = useState<boolean[]>(Array(COUNT).fill(false));

    const onExpandedChange: FactionInfoProps['onExpandedChange'] = (index, e, expand) => {
        const newExpanded = [...expanded];
        newExpanded[index] = expand;
        setExpanded(newExpanded);
    };

    if (resource.kind === 'error') return <LoadFailure retry={retry} />;
    if (pending) return <CircularProgress aria-label="Loading factions" />;
    const onFactionChange = setSelectedName;

    const index = factionNames.indexOf(displayName);
    const lastIndex = factionNames.length - 1;
    const prevFaction = index === 0 ? factionNames[lastIndex] : factionNames[index - 1];
    const nextFaction = index === lastIndex ? factionNames[0] : factionNames[index + 1];

    return (
        <>
            <AppBar className={classes.appBar} color="inherit" position="sticky">
                <Toolbar classes={{ root: classes.toolbar }} disableGutters>
                    <Tooltip title={prevFaction}>
                        <IconButton onClick={() => onFactionChange(prevFaction)} size="large">
                            <NavigateBeforeIcon />
                        </IconButton>
                    </Tooltip>
                    <FactionSelect
                        fullWidth
                        factionNames={factionNames}
                        value={displayName}
                        onChange={onFactionChange}
                        hideNone
                    />
                    <Tooltip title={nextFaction}>
                        <IconButton onClick={() => onFactionChange(nextFaction)} size="large">
                            <NavigateNextIcon />
                        </IconButton>
                    </Tooltip>
                </Toolbar>
                <Toolbar>
                    <Grid container direction="row" justifyContent="flex-start" spacing={1}>
                        <Grid item>
                            <Button
                                size="small"
                                color="primary"
                                variant="contained"
                                disabled={expanded.every(e => !e)}
                                onClick={() => setExpanded(Array(COUNT).fill(false))}
                            >
                                <Typography variant="body2">Collapse</Typography>
                            </Button>
                        </Grid>
                        <Grid item>
                            <Button
                                size="small"
                                color="primary"
                                variant="contained"
                                disabled={expanded.every(e => e)}
                                onClick={() => setExpanded(Array(COUNT).fill(true))}
                            >
                                <Typography variant="body2">Expand</Typography>
                            </Button>
                        </Grid>
                    </Grid>
                </Toolbar>
            </AppBar>
            {pending ? (
                <Grid sx={{ height: '100%' }} container justifyContent="center" alignItems="center" direction="column">
                    <CircularProgress size={'50vw'} />
                </Grid>
            ) : (
                <FactionInfo faction={factionInfo} expanded={expanded} onExpandedChange={onExpandedChange} />
            )}
        </>
    );
}

export default Factions;
