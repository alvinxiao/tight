import React from 'react';
import { Alert, Button, Stack } from '@mui/material';

export default function LoadFailure({ retry }: { retry: () => void }) {
    return <Stack spacing={2} sx={{ p: 2 }}>
        <Alert severity="error">Could not load this information. Check the host connection and try again.</Alert>
        <Button onClick={retry}>Retry loading information</Button>
    </Stack>;
}
