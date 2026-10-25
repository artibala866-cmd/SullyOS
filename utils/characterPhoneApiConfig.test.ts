// @vitest-environment jsdom
import {beforeEach,describe,expect,it} from 'vitest';
import {readCharacterPhoneApiSettings,writeCharacterPhoneApiSettings,resolveCharacterPhoneApi} from './characterPhoneApiConfig';

beforeEach(()=>localStorage.clear());

describe('isolated Char phone API',()=>{
  const fallback={baseUrl:'https://chat.example/v1',apiKey:'global-key',model:'chat-model',visionApi:{enabled:true}};
  it('inherits the provided dialogue config until a complete override is enabled',()=>{
    expect(resolveCharacterPhoneApi('alice',fallback)).toEqual(fallback);
    writeCharacterPhoneApiSettings('alice',{enabled:true,baseUrl:'https://phone.example/v1'});
    expect(resolveCharacterPhoneApi('alice',fallback)).toEqual(fallback);
    writeCharacterPhoneApiSettings('alice',{apiKey:'phone-key',model:'phone-model'});
    expect(resolveCharacterPhoneApi('alice',fallback)).toMatchObject({
      baseUrl:'https://phone.example/v1',apiKey:'phone-key',model:'phone-model',
      visionApi:fallback.visionApi,
    });
    expect(resolveCharacterPhoneApi('bob',fallback)).toEqual(fallback);
    writeCharacterPhoneApiSettings('alice',{enabled:false});
    expect(resolveCharacterPhoneApi('alice',fallback)).toEqual(fallback);
    expect(readCharacterPhoneApiSettings('alice').apiKey).toBe('phone-key');
  });
  it('rejects incomplete endpoints rather than mixing configurations',()=>{
    writeCharacterPhoneApiSettings('alice',{enabled:true,baseUrl:'javascript:invalid',apiKey:'key',model:'model'});
    expect(resolveCharacterPhoneApi('alice',fallback)).toEqual(fallback);
  });
});
