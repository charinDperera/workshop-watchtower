/** The app version from package.json, inlined at build time (only this field is bundled). */
import { version } from '../../package.json';

export const APP_VERSION: string = version;
