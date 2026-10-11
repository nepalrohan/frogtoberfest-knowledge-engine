import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from './config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: AppConfigService,
          useValue: {
            appVersion: '1.0.0',
            port: 5000,
            webUrl: 'http://localhost:3000',
            corsOrigin: '*',
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('should return health status with version', () => {
      expect(appController.health()).toEqual({
        status: 'ok',
        service: 'api',
        version: '1.0.0',
      });
    });
  });
});
