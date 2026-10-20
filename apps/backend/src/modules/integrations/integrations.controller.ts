import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/configuration';
import { NotionOAuthService } from './notion-oauth.service';
import { NotionPagesService } from './notion-pages.service';
import { ConnectionStorageService } from './connection-storage.service';
import { StructuredLogger } from '../../common/logger';
import { AdminAuthGuard } from '../../common/guards/admin-auth.guard';
import {
  NotionAuthorizeResponseDto,
  NotionConnectionStatusDto,
  NotionDisconnectResponseDto,
  NotionPagesResponseDto,
  SaveNotionPagesDto,
  SaveNotionPagesResponseDto,
  ConnectNotionTokenDto,
  ConnectNotionTokenResponseDto,
} from './dto';

/* Controller handling Notion OAuth authorization lifecycle and connection status */
@Controller({ path: 'integrations/notion', version: '1' })
export class IntegrationsController {
  private readonly logger = new StructuredLogger('IntegrationsController');

  constructor(
    private readonly configService: AppConfigService,
    private readonly notionOAuthService: NotionOAuthService,
    private readonly notionPagesService: NotionPagesService,
    private readonly connectionStorageService: ConnectionStorageService,
  ) { }

  /* Initiates OAuth authorization flow by returning the Notion authorization URL */
  @Get('oauth/authorize')
  @UseGuards(AdminAuthGuard)
  async authorize(
    @Req() req: Request & { user?: { id: string; role: string } },
  ): Promise<NotionAuthorizeResponseDto> {
    const userId = req.user?.id || 'admin-user';
    const { authorizationUrl } =
      await this.notionOAuthService.generateAuthorizationUrl(userId);
    return { authorizationUrl };
  }

  /* Handles the OAuth callback from Notion, validating state and exchanging code for credentials */
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.configService.frontendUrl.replace(/\/+$/, '');

    /* Handle user cancellation or provider error */
    if (error) {
      this.logger.warn('Notion OAuth authorization was denied or cancelled', {
        error,
      });
      res.redirect(
        HttpStatus.FOUND,
        `${frontendUrl}/integrations?status=cancelled&error=${encodeURIComponent(error)}`,
      );
      return;
    }

    /* Validate anti-CSRF state */
    const isValidState = await this.notionOAuthService.validateAndConsumeState(
      state || '',
    );
    if (!state || !isValidState) {
      this.logger.warn('Notion OAuth callback received invalid or expired state', {
        state: state ? '[PROVIDED]' : '[MISSING]',
      });
      res.redirect(
        HttpStatus.FOUND,
        `${frontendUrl}/integrations?status=error&message=invalid_state`,
      );
      return;
    }

    /* Verify authorization code presence */
    if (!code) {
      this.logger.warn('Notion OAuth callback received missing authorization code');
      res.redirect(
        HttpStatus.FOUND,
        `${frontendUrl}/integrations?status=error&message=missing_code`,
      );
      return;
    }

    try {
      /* Exchange authorization code for token */
      const tokenData = await this.notionOAuthService.exchangeCodeForToken(code);

      /* Persist encrypted connection credentials */
      await this.connectionStorageService.saveConnection({
        workspaceId: tokenData.workspace_id,
        workspaceName: tokenData.workspace_name,
        workspaceIcon: tokenData.workspace_icon,
        accessToken: tokenData.access_token,
        connectedBy: 'admin-user',
      });

      this.logger.log('Notion connection saved successfully', {
        workspaceId: tokenData.workspace_id,
        workspaceName: tokenData.workspace_name,
      });

      res.redirect(
        HttpStatus.FOUND,
        `${frontendUrl}/integrations?status=success&workspace=${encodeURIComponent(
          tokenData.workspace_name,
        )}`,
      );
    } catch (err) {
      this.logger.error('Failed to exchange Notion authorization code', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.redirect(
        HttpStatus.FOUND,
        `${frontendUrl}/integrations?status=error&message=exchange_failed`,
      );
    }
  }

  /* Retrieves non-sensitive active connection status */
  @Get('status')
  @UseGuards(AdminAuthGuard)
  async getStatus(): Promise<NotionConnectionStatusDto> {
    const conn = await this.connectionStorageService.getConnection('notion');
    if (!conn || conn.status !== 'connected') {
      return {
        connected: false,
        workspaceId: null,
        workspaceName: null,
        workspaceIcon: null,
        connectedAt: null,
        selectedPagesCount: 0,
      };
    }

    return {
      connected: true,
      workspaceId: conn.workspace_id,
      workspaceName: conn.workspace_name,
      workspaceIcon: conn.workspace_icon,
      connectedAt: conn.updated_at.toISOString(),
      selectedPagesCount: conn.selected_page_ids?.length ?? 0,
    };
  }

  /* Retrieves available pages from Notion API and returns current user selections */
  @Get('pages')
  @UseGuards(AdminAuthGuard)
  async getPages(): Promise<NotionPagesResponseDto> {
    const conn = await this.connectionStorageService.getConnection('notion');
    if (!conn || conn.status !== 'connected') {
      return { pages: [], selectedPageIds: [] };
    }

    const token = await this.connectionStorageService.getDecryptedToken('notion');
    if (!token) {
      return { pages: [], selectedPageIds: [] };
    }

    const pages = await this.notionPagesService.fetchWorkspacePages(token);
    const selectedPageIds = await this.connectionStorageService.getSelectedPages('notion');

    return {
      pages,
      selectedPageIds,
    };
  }

  /* Saves user-selected Notion page IDs (can be empty array to decouple connection from document selection) */
  @Post('pages')
  @UseGuards(AdminAuthGuard)
  async savePages(
    @Body() body: SaveNotionPagesDto,
  ): Promise<SaveNotionPagesResponseDto> {
    const conn = await this.connectionStorageService.getConnection('notion');
    if (!conn || conn.status !== 'connected') {
      throw new BadRequestException('Notion workspace is not connected');
    }

    const pageIds = Array.isArray(body?.pageIds) ? body.pageIds : [];
    const updated = await this.connectionStorageService.saveSelectedPages('notion', pageIds);

    return {
      success: true,
      selectedCount: updated.length,
      selectedPageIds: updated,
    };
  }

  /* Connects directly via Notion Internal Integration Token, bypassing OAuth page picker */
  @Post('token')
  @UseGuards(AdminAuthGuard)
  async connectWithToken(
    @Body() body: ConnectNotionTokenDto,
  ): Promise<ConnectNotionTokenResponseDto> {
    if (!body?.token || typeof body.token !== 'string' || !body.token.trim()) {
      throw new BadRequestException('Notion token is required');
    }

    const token = body.token.trim();
    const workspaceInfo = await this.notionPagesService.validateTokenAndGetWorkspace(
      token,
      body.workspaceName,
    );

    await this.connectionStorageService.saveConnection({
      workspaceId: workspaceInfo.workspaceId,
      workspaceName: workspaceInfo.workspaceName,
      workspaceIcon: workspaceInfo.workspaceIcon,
      accessToken: token,
      connectedBy: 'admin-user',
    });

    this.logger.log('Notion connected successfully via integration token', {
      workspaceId: workspaceInfo.workspaceId,
      workspaceName: workspaceInfo.workspaceName,
    });

    return {
      success: true,
      workspaceName: workspaceInfo.workspaceName,
    };
  }

  /* Disconnects the active Notion integration */
  @Post('disconnect')
  @UseGuards(AdminAuthGuard)
  async disconnect(): Promise<NotionDisconnectResponseDto> {
    await this.connectionStorageService.disconnect('notion');
    return {
      success: true,
      message: 'Notion integration disconnected successfully',
    };
  }
}
