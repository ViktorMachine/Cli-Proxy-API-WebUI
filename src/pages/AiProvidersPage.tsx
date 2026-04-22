import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AmpcodeSection,
  ClaudeSection,
  CodexSection,
  GeminiSection,
  OpenAISection,
  VertexSection,
  ProviderNav,
  useProviderStats,
} from '@/components/providers';
import type { VerifyStatus } from '@/components/providers/OpenAISection/OpenAISection';
import {
  buildOpenAIChatCompletionsEndpoint,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiCallApi, ampcodeApi, modelsApi, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore, useThemeStore } from '@/stores';
import type { GeminiKeyConfig, ModelAlias, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import styles from './AiProvidersPage.module.scss';

const OPENAI_TEST_TIMEOUT_MS = 30000;
const VERIFY_CONCURRENCY = 3;

export function AiProvidersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);

  const hasMounted = useRef(false);
  const [loading, setLoading] = useState(() => !isCacheValid());
  const [error, setError] = useState('');

  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyConfig[]>(
    () => config?.geminiApiKeys || []
  );
  const [codexConfigs, setCodexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.codexApiKeys || []
  );
  const [claudeConfigs, setClaudeConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.claudeApiKeys || []
  );
  const [vertexConfigs, setVertexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.vertexApiKeys || []
  );
  const [openaiProviders, setOpenaiProviders] = useState<OpenAIProviderConfig[]>(
    () => config?.openaiCompatibility || []
  );

  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({});
  const [verifyAllLoading, setVerifyAllLoading] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importData, setImportData] = useState<any>(null);

  const disableControls = connectionStatus !== 'connected';
  const isSwitching = Boolean(configSwitchingKey);

  const { keyStats, usageDetails, loadKeyStats, refreshKeyStats } = useProviderStats();

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  const loadConfigs = useCallback(async () => {
    const hasValidCache = isCacheValid();
    if (!hasValidCache) {
      setLoading(true);
    }
    setError('');
    try {
      const [configResult, vertexResult, ampcodeResult] = await Promise.allSettled([
        fetchConfig(),
        providersApi.getVertexConfigs(),
        ampcodeApi.getAmpcode(),
      ]);

      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }

      const data = configResult.value;
      setGeminiKeys(data?.geminiApiKeys || []);
      setCodexConfigs(data?.codexApiKeys || []);
      setClaudeConfigs(data?.claudeApiKeys || []);
      setVertexConfigs(data?.vertexApiKeys || []);
      setOpenaiProviders(data?.openaiCompatibility || []);

      if (vertexResult.status === 'fulfilled') {
        setVertexConfigs(vertexResult.value || []);
        updateConfigValue('vertex-api-key', vertexResult.value || []);
        clearCache('vertex-api-key');
      }

      if (ampcodeResult.status === 'fulfilled') {
        updateConfigValue('ampcode', ampcodeResult.value);
        clearCache('ampcode');
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [clearCache, fetchConfig, isCacheValid, t, updateConfigValue]);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    loadConfigs();
    void loadKeyStats().catch(() => {});
  }, [loadConfigs, loadKeyStats]);

  useEffect(() => {
    if (config?.geminiApiKeys) setGeminiKeys(config.geminiApiKeys);
    if (config?.codexApiKeys) setCodexConfigs(config.codexApiKeys);
    if (config?.claudeApiKeys) setClaudeConfigs(config.claudeApiKeys);
    if (config?.vertexApiKeys) setVertexConfigs(config.vertexApiKeys);
    if (config?.openaiCompatibility) setOpenaiProviders(config.openaiCompatibility);
  }, [
    config?.geminiApiKeys,
    config?.codexApiKeys,
    config?.claudeApiKeys,
    config?.vertexApiKeys,
    config?.openaiCompatibility,
  ]);

  useHeaderRefresh(refreshKeyStats);

  const openEditor = useCallback(
    (path: string) => {
      navigate(path, { state: { fromAiProviders: true } });
    },
    [navigate]
  );

  const deleteGemini = async (index: number) => {
    const entry = geminiKeys[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.gemini_delete_title', { defaultValue: 'Delete Gemini Key' }),
      message: t('ai_providers.gemini_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteGeminiKey(entry.apiKey);
          const next = geminiKeys.filter((_, idx) => idx !== index);
          setGeminiKeys(next);
          updateConfigValue('gemini-api-key', next);
          clearCache('gemini-api-key');
          showNotification(t('notification.gemini_key_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const setConfigEnabled = async (
    provider: 'gemini' | 'codex' | 'claude' | 'vertex',
    index: number,
    enabled: boolean
  ) => {
    if (provider === 'gemini') {
      const current = geminiKeys[index];
      if (!current) return;

      const switchingKey = `${provider}:${current.apiKey}`;
      setConfigSwitchingKey(switchingKey);

      const previousList = geminiKeys;
      const nextExcluded = enabled
        ? withoutDisableAllModelsRule(current.excludedModels)
        : withDisableAllModelsRule(current.excludedModels);
      const nextItem: GeminiKeyConfig = { ...current, excludedModels: nextExcluded };
      const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

      setGeminiKeys(nextList);
      updateConfigValue('gemini-api-key', nextList);
      clearCache('gemini-api-key');

      try {
        await providersApi.saveGeminiKeys(nextList);
        showNotification(
          enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
          'success'
        );
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        setGeminiKeys(previousList);
        updateConfigValue('gemini-api-key', previousList);
        clearCache('gemini-api-key');
        showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
      } finally {
        setConfigSwitchingKey(null);
      }
      return;
    }

    const source =
      provider === 'codex'
        ? codexConfigs
        : provider === 'claude'
          ? claudeConfigs
          : vertexConfigs;
    const current = source[index];
    if (!current) return;

    const switchingKey = `${provider}:${current.apiKey}`;
    setConfigSwitchingKey(switchingKey);

    const previousList = source;
    const nextExcluded = enabled
      ? withoutDisableAllModelsRule(current.excludedModels)
      : withDisableAllModelsRule(current.excludedModels);
    const nextItem: ProviderKeyConfig = { ...current, excludedModels: nextExcluded };
    const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

    if (provider === 'codex') {
      setCodexConfigs(nextList);
      updateConfigValue('codex-api-key', nextList);
      clearCache('codex-api-key');
    } else if (provider === 'claude') {
      setClaudeConfigs(nextList);
      updateConfigValue('claude-api-key', nextList);
      clearCache('claude-api-key');
    } else {
      setVertexConfigs(nextList);
      updateConfigValue('vertex-api-key', nextList);
      clearCache('vertex-api-key');
    }

    try {
      if (provider === 'codex') {
        await providersApi.saveCodexConfigs(nextList);
      } else if (provider === 'claude') {
        await providersApi.saveClaudeConfigs(nextList);
      } else {
        await providersApi.saveVertexConfigs(nextList);
      }
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (provider === 'codex') {
        setCodexConfigs(previousList);
        updateConfigValue('codex-api-key', previousList);
        clearCache('codex-api-key');
      } else if (provider === 'claude') {
        setClaudeConfigs(previousList);
        updateConfigValue('claude-api-key', previousList);
        clearCache('claude-api-key');
      } else {
        setVertexConfigs(previousList);
        updateConfigValue('vertex-api-key', previousList);
        clearCache('vertex-api-key');
      }
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const deleteProviderEntry = async (type: 'codex' | 'claude', index: number) => {
    const source = type === 'codex' ? codexConfigs : claudeConfigs;
    const entry = source[index];
    if (!entry) return;
    showConfirmation({
      title: t(`ai_providers.${type}_delete_title`, { defaultValue: `Delete ${type === 'codex' ? 'Codex' : 'Claude'} Config` }),
      message: t(`ai_providers.${type}_delete_confirm`),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          if (type === 'codex') {
            await providersApi.deleteCodexConfig(entry.apiKey);
            const next = codexConfigs.filter((_, idx) => idx !== index);
            setCodexConfigs(next);
            updateConfigValue('codex-api-key', next);
            clearCache('codex-api-key');
            showNotification(t('notification.codex_config_deleted'), 'success');
          } else {
            await providersApi.deleteClaudeConfig(entry.apiKey);
            const next = claudeConfigs.filter((_, idx) => idx !== index);
            setClaudeConfigs(next);
            updateConfigValue('claude-api-key', next);
            clearCache('claude-api-key');
            showNotification(t('notification.claude_config_deleted'), 'success');
          }
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteVertex = async (index: number) => {
    const entry = vertexConfigs[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.vertex_delete_title', { defaultValue: 'Delete Vertex Config' }),
      message: t('ai_providers.vertex_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteVertexConfig(entry.apiKey);
          const next = vertexConfigs.filter((_, idx) => idx !== index);
          setVertexConfigs(next);
          updateConfigValue('vertex-api-key', next);
          clearCache('vertex-api-key');
          showNotification(t('notification.vertex_config_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteOpenai = async (index: number) => {
    const entry = openaiProviders[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.openai_delete_title', { defaultValue: 'Delete OpenAI Provider' }),
      message: t('ai_providers.openai_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteOpenAIProvider(entry.name);
          const next = openaiProviders.filter((_, idx) => idx !== index);
          setOpenaiProviders(next);
          updateConfigValue('openai-compatibility', next);
          clearCache('openai-compatibility');
          showNotification(t('notification.openai_provider_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const buildHeadersForProvider = (provider: OpenAIProviderConfig): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...provider.headers,
    };
    const firstKey = provider.apiKeyEntries?.[0]?.apiKey;
    if (firstKey && !Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) {
      headers.Authorization = `Bearer ${firstKey}`;
    }
    return headers;
  };

  const testModelConnectivity = async (
    provider: OpenAIProviderConfig,
    modelName: string
  ): Promise<boolean> => {
    const endpoint = buildOpenAIChatCompletionsEndpoint(provider.baseUrl);
    if (!endpoint) return false;

    const headers = buildHeadersForProvider(provider);

    try {
      const result = await apiCallApi.request(
        {
          method: 'POST',
          url: endpoint,
          header: headers,
          data: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: 'Hi' }],
            stream: false,
            max_tokens: 5,
          }),
        },
        { timeout: OPENAI_TEST_TIMEOUT_MS }
      );
      return result.statusCode === 200;
    } catch {
      return false;
    }
  };

  const verifyOpenaiModels = async (index: number) => {
    const provider = openaiProviders[index];
    if (!provider) return;

    setVerifyStatus((prev) => ({ ...prev, [index]: 'loading' }));

    try {
      // 获取模型列表
      const firstKey = provider.apiKeyEntries?.[0]?.apiKey;
      const models = await modelsApi.fetchModelsViaApiCall(
        provider.baseUrl,
        firstKey,
        provider.headers || {}
      );

      if (!models.length) {
        showNotification(t('ai_providers.openai_verify_no_models'), 'warning');
        setVerifyStatus((prev) => ({ ...prev, [index]: 'error' }));
        return;
      }

      // 并发检测模型连通性
      const availableModels: ModelAlias[] = [];
      const chunks: ModelAlias[][] = [];
      for (let i = 0; i < models.length; i += VERIFY_CONCURRENCY) {
        chunks.push(models.slice(i, i + VERIFY_CONCURRENCY));
      }

      for (const chunk of chunks) {
        const results = await Promise.all(
          chunk.map(async (model) => {
            const isAvailable = await testModelConnectivity(provider, model.name);
            return isAvailable ? model : null;
          })
        );
        results.forEach((model) => {
          if (model) availableModels.push(model);
        });
      }

      // 更新 Provider
      const updated: OpenAIProviderConfig = { ...provider, models: availableModels };
      await providersApi.updateOpenAIProvider(index, updated);

      // 更新本地状态
      setOpenaiProviders((prev) => prev.map((p, i) => (i === index ? updated : p)));
      updateConfigValue('openai-compatibility', openaiProviders.map((p, i) => (i === index ? updated : p)));
      clearCache('openai-compatibility');

      showNotification(
        t('ai_providers.openai_verify_success', {
          count: models.length,
          kept: availableModels.length,
        }),
        'success'
      );
      setVerifyStatus((prev) => ({ ...prev, [index]: 'success' }));
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        t('ai_providers.openai_verify_error', { message }),
        'error'
      );
      setVerifyStatus((prev) => ({ ...prev, [index]: 'error' }));
    }
  };

  const verifyAllOpenaiModels = async () => {
    if (!openaiProviders.length) return;

    setVerifyAllLoading(true);

    for (let i = 0; i < openaiProviders.length; i += 1) {
      await verifyOpenaiModels(i);
    }

    showNotification(
      t('ai_providers.openai_verify_all_complete', { count: openaiProviders.length }),
      'success'
    );
    setVerifyAllLoading(false);
  };

  // 导出配置
  const exportConfig = () => {
    try {
      const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        providers: {
          gemini: geminiKeys,
          codex: codexConfigs,
          claude: claudeConfigs,
          vertex: vertexConfigs,
          openai: openaiProviders,
          ampcode: config?.ampcode,
        },
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ai-providers-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotification(t('ai_providers.export_success'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('ai_providers.export_failed')}: ${message}`, 'error');
    }
  };

  // 处理导入文件
  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // 验证数据格式
        if (!data.providers) {
          showNotification(t('ai_providers.import_invalid_format'), 'error');
          return;
        }

        // 检查是否有有效数据
        const hasData =
          (data.providers.gemini?.length > 0) ||
          (data.providers.codex?.length > 0) ||
          (data.providers.claude?.length > 0) ||
          (data.providers.vertex?.length > 0) ||
          (data.providers.openai?.length > 0) ||
          (data.providers.ampcode);

        if (!hasData) {
          showNotification(t('ai_providers.import_no_data'), 'error');
          return;
        }

        setImportData(data);
        setShowImportDialog(true);
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        showNotification(`${t('ai_providers.import_invalid_format')}: ${message}`, 'error');
      }
    };
    reader.readAsText(file);

    // 重置input值，允许重复选择同一文件
    event.target.value = '';
  };

  // 执行导入
  const executeImport = async () => {
    if (!importData) return;

    try {
      const providers = importData.providers;
      let successCount = 0;
      let totalCount = 0;

      // 导入 Gemini 配置
      if (providers.gemini?.length > 0) {
        totalCount++;
        const newGemini = importMode === 'merge'
          ? [...geminiKeys, ...providers.gemini]
          : providers.gemini;

        await providersApi.saveGeminiKeys(newGemini);
        setGeminiKeys(newGemini);
        updateConfigValue('gemini-api-key', newGemini);
        clearCache('gemini-api-key');
        successCount++;
      }

      // 导入 Codex 配置
      if (providers.codex?.length > 0) {
        totalCount++;
        const newCodex = importMode === 'merge'
          ? [...codexConfigs, ...providers.codex]
          : providers.codex;

        await providersApi.saveCodexConfigs(newCodex);
        setCodexConfigs(newCodex);
        updateConfigValue('codex-api-key', newCodex);
        clearCache('codex-api-key');
        successCount++;
      }

      // 导入 Claude 配置
      if (providers.claude?.length > 0) {
        totalCount++;
        const newClaude = importMode === 'merge'
          ? [...claudeConfigs, ...providers.claude]
          : providers.claude;

        await providersApi.saveClaudeConfigs(newClaude);
        setClaudeConfigs(newClaude);
        updateConfigValue('claude-api-key', newClaude);
        clearCache('claude-api-key');
        successCount++;
      }

      // 导入 Vertex 配置
      if (providers.vertex?.length > 0) {
        totalCount++;
        const newVertex = importMode === 'merge'
          ? [...vertexConfigs, ...providers.vertex]
          : providers.vertex;

        await providersApi.saveVertexConfigs(newVertex);
        setVertexConfigs(newVertex);
        updateConfigValue('vertex-api-key', newVertex);
        clearCache('vertex-api-key');
        successCount++;
      }

      // 导入 OpenAI 配置
      if (providers.openai?.length > 0) {
        totalCount++;
        const newOpenai = importMode === 'merge'
          ? [...openaiProviders, ...providers.openai]
          : providers.openai;

        // 批量保存 OpenAI 提供商
        for (let i = 0; i < newOpenai.length; i++) {
          const provider = newOpenai[i];
          if (importMode === 'replace' || i >= openaiProviders.length) {
            await providersApi.saveOpenAIProvider(provider);
          }
        }

        setOpenaiProviders(newOpenai);
        updateConfigValue('openai-compatibility', newOpenai);
        clearCache('openai-compatibility');
        successCount++;
      }

      // 导入 Ampcode 配置
      if (providers.ampcode) {
        totalCount++;
        await ampcodeApi.saveAmpcode(providers.ampcode);
        updateConfigValue('ampcode', providers.ampcode);
        clearCache('ampcode');
        successCount++;
      }

      setShowImportDialog(false);
      setImportData(null);

      if (successCount === totalCount) {
        showNotification(
          t('ai_providers.import_success', { total: totalCount }),
          'success'
        );
      } else {
        showNotification(
          t('ai_providers.import_partial', { success: successCount, total: totalCount }),
          'warning'
        );
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('ai_providers.import_failed')}: ${message}`, 'error');
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('ai_providers.title')}</h1>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.exportButton}
            onClick={exportConfig}
            disabled={disableControls}
            title={t('ai_providers.export_hint')}
          >
            {t('ai_providers.export_button')}
          </button>
          <label className={styles.importButton}>
            <input
              type="file"
              accept=".json"
              onChange={handleImportFile}
              disabled={disableControls}
              style={{ display: 'none' }}
            />
            <span>{t('ai_providers.import_button')}</span>
          </label>
        </div>
      </div>
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}

        <div id="provider-gemini">
          <GeminiSection
            configs={geminiKeys}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/gemini/new')}
            onEdit={(index) => openEditor(`/ai-providers/gemini/${index}`)}
            onDelete={deleteGemini}
            onToggle={(index, enabled) => void setConfigEnabled('gemini', index, enabled)}
          />
        </div>

        <div id="provider-codex">
          <CodexSection
            configs={codexConfigs}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/codex/new')}
            onEdit={(index) => openEditor(`/ai-providers/codex/${index}`)}
            onDelete={(index) => void deleteProviderEntry('codex', index)}
            onToggle={(index, enabled) => void setConfigEnabled('codex', index, enabled)}
          />
        </div>

        <div id="provider-claude">
          <ClaudeSection
            configs={claudeConfigs}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/claude/new')}
            onEdit={(index) => openEditor(`/ai-providers/claude/${index}`)}
            onDelete={(index) => void deleteProviderEntry('claude', index)}
            onToggle={(index, enabled) => void setConfigEnabled('claude', index, enabled)}
          />
        </div>

        <div id="provider-vertex">
          <VertexSection
            configs={vertexConfigs}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/vertex/new')}
            onEdit={(index) => openEditor(`/ai-providers/vertex/${index}`)}
            onDelete={deleteVertex}
            onToggle={(index, enabled) => void setConfigEnabled('vertex', index, enabled)}
          />
        </div>

        <div id="provider-ampcode">
          <AmpcodeSection
            config={config?.ampcode}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onEdit={() => openEditor('/ai-providers/ampcode')}
          />
        </div>

        <div id="provider-openai">
          <OpenAISection
            configs={openaiProviders}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            resolvedTheme={resolvedTheme}
            verifyStatus={verifyStatus}
            verifyAllLoading={verifyAllLoading}
            onAdd={() => openEditor('/ai-providers/openai/new')}
            onEdit={(index) => openEditor(`/ai-providers/openai/${index}`)}
            onDelete={deleteOpenai}
            onVerifyModels={(index) => void verifyOpenaiModels(index)}
            onVerifyAll={() => void verifyAllOpenaiModels()}
          />
        </div>
      </div>

      {/* 导入确认对话框 */}
      {showImportDialog && importData && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h2>{t('ai_providers.import_confirm_title')}</h2>
            <p>{t('ai_providers.import_confirm_message')}</p>

            <div className={styles.importPreview}>
              <h3>{t('ai_providers.import_preview_title')}</h3>
              <ul>
                {importData.providers.gemini?.length > 0 && (
                  <li>{t('ai_providers.import_preview_gemini', { count: importData.providers.gemini.length })}</li>
                )}
                {importData.providers.codex?.length > 0 && (
                  <li>{t('ai_providers.import_preview_codex', { count: importData.providers.codex.length })}</li>
                )}
                {importData.providers.claude?.length > 0 && (
                  <li>{t('ai_providers.import_preview_claude', { count: importData.providers.claude.length })}</li>
                )}
                {importData.providers.vertex?.length > 0 && (
                  <li>{t('ai_providers.import_preview_vertex', { count: importData.providers.vertex.length })}</li>
                )}
                {importData.providers.openai?.length > 0 && (
                  <li>{t('ai_providers.import_preview_openai', { count: importData.providers.openai.length })}</li>
                )}
                {importData.providers.ampcode && (
                  <li>{t('ai_providers.import_preview_ampcode', { status: t('common.yes') })}</li>
                )}
              </ul>
            </div>

            <div className={styles.importMode}>
              <label>
                <input
                  type="radio"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
                />
                <div>
                  <strong>{t('ai_providers.import_mode_merge')}</strong>
                  <p>{t('ai_providers.import_mode_merge_desc')}</p>
                </div>
              </label>
              <label>
                <input
                  type="radio"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
                />
                <div>
                  <strong>{t('ai_providers.import_mode_replace')}</strong>
                  <p>{t('ai_providers.import_mode_replace_desc')}</p>
                </div>
              </label>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => {
                  setShowImportDialog(false);
                  setImportData(null);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={styles.confirmButton}
                onClick={executeImport}
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProviderNav />
    </div>
  );
}
