// Must precede App and every module which reads storage during evaluation.
import { installUserSaveStorage } from './userSaveScope';
installUserSaveStorage();
