import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from './config';
import { AppService } from './app.service';

@Controller('health')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly configService: AppConfigService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('status')
  health() {
    return {
      status: 'ok',
      service: 'api',
      version: this.configService.appVersion,
    };
  }
}
