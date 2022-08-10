export const pause = async s => new Promise( r => setTimeout( r, s * 1000 ) );
