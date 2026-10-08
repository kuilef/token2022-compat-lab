# Token-2022 compatibility lab

Ограниченный локальный regression fixture: два выпущенных JS клиента выполняют одинаковые сценарии в LiteSVM с настоящими Token-2022 и validating transfer-hook binaries. Это синтетический пример интеграции приложения, а не обнаруженная live уязвимость.

Extra-account PDA hook вычисляется из `recipient token account.owner`: `AccountData { accountIndex: 2, dataIndex: 32, length: 32 }`. Mint, source ATA, hook validation PDA и исходные балансы создаются настоящими инструкциями. Read-only SDK adapters получают account data прямо из текущего LiteSVM ledger; будущие ATA bytes им не подставляются. Hook проверяет transferring flags и список extra accounts. Никаких внешних RPC или сетевых Solana транзакций.

| Сценарий | Legacy 0.4.15 | Kit 0.19.0 | Token balances source / recipient |
| --- | --- | --- | --- |
| Recipient ATA существует | success, hook CPI | success, hook CPI | 60 / 40 |
| ATA отсутствует, create-idempotent уже подготовлен, стандартный transfer builder | resolver failure, транзакция не отправлена | resolver failure, транзакция не отправлена | 100 / отсутствует |
| ATA отсутствует, корректный extra PDA разрешен приложением заранее | atomic create + transfer, hook CPI | atomic create + transfer, hook CPI | 60 / 40 |
| ATA отсутствует, extra PDA от неправильного owner | runtime rejection; rollback | runtime rejection; rollback | 100 / отсутствует |

Baseline legacy: `TokenTransferHookAccountDataNotFound`. Baseline Kit: account required by an account-data seed was not found. Runtime rejection у обоих: инструкция 1, custom `2724315840` (`0xa261c2c0`). Эта ошибка возникает при on-chain extra-account resolution Token-2022 до вызова hook. Логи подтверждают успешное выполнение ATA initialization перед ошибкой; проверка состояния подтверждает отмену создания ATA. Rollback сравнивает полный data hash, owner и lamports token accounts, mint, validation PDA и обоих extra PDAs. Комиссия payer за отклоненную транзакцию исключена из сравнения.

Оба клиента сами строят свои ATA и transfer instructions и подписывают транзакции. Common setup использует legacy instructions для создания одного и того же исходного состояния. Сравниваются смысл ошибок и состояние; одинаковые сериализованные транзакции не требуются.

## Запуск

Linux x64 или установленный WSL Ubuntu. Node закреплен на 24.13.0; `bootstrap.sh` скачивает официальный Node в `.tools` и проверяет SHA256 по официальному manifest. Глобальные зависимости не нужны.

```sh
bash setup.sh
export PATH="$PWD/.tools/node/bin:$PATH"
python3 scripts/fetch-fixtures.py
npm run check
npm run report
```

`setup.sh` при наличии lockfile использует `npm ci`; lifecycle scripts отключены. Fixtures скачиваются с официального GitHub и проверяются по `fixtures.json`. После подготовки тесты работают без сети. TypeScript/transpilation/build отсутствуют: это runnable ESM JavaScript, lint проверяет синтаксис и базовые ошибки, тесты выполняют реальные SDK API.

На AMETHYST Windows исходники находятся в отдельной папке `token2022-compat-lab`. Для быстрого выполнения по Linux filesystem:

```powershell
wsl.exe -d Ubuntu-22.04 -- bash scripts/prepare-wsl.sh
wsl.exe -d Ubuntu-22.04 -- bash scripts/run-wsl.sh npm run check
wsl.exe -d Ubuntu-22.04 -- bash scripts/run-wsl.sh npm run report
```

Это создает новую отдельную рабочую копию под `/home/kuil/codex-workspaces/token2022-compat-lab/`; `.wsl-stage-path` хранит ее путь. Prepare скачивает и проверяет Node и fixtures, если они еще отсутствуют. Тесты и отчет синхронизируются из основной папки. Другие проекты и системные настройки не меняются. WSL `/tmp` на этой машине не сохраняется между сеансами, поэтому он не используется.

## Что закреплено

- `@solana/spl-token` 0.4.15; `@solana-program/token-2022` 0.19.0; `@solana/kit` 8.3.0; LiteSVM 1.5.0. Все зависимости и integrity hashes находятся в `package-lock.json`.
- Token-2022 program 11.0.0: source commit `9bc02757f600ffe754746708a8a072bcd49d1260`; release binary SHA256 `9bbf90b30e06778ca0feca100b29f0eeb9be576ae024f6323cc207308f51a5d1`.
- Upstream validating hook `spl_transfer_hook_example_no_default_features.so` из commit `385831f47aabd033a08a89a037a7b6ba3806c148`; SHA256 `b82d95a35b0460721c253c39874d3d4932bcb5c75bbb975966025586bab4ced2`; Git blob `3c4f70626995fc01ab8ce36c85bb7ade933e4cf9`.
- Associated-token program и runtime feature set поставляются закрепленным LiteSVM package. Это локальный SVM runtime, а не отдельный Agave validator.

`fixtures.json` содержит URLs и provenance. `report.json` содержит все восемь observed/expected результатов, lookup traces, CPI logs, состояние и cross-client сравнения. Hook binary не пересобирался: закреплено происхождение upstream fixture, но соответствие конкретному source tree transfer-hook не подтверждено reproducible build. У Token-2022 официальный executable hash отличается от SHA256 ELF-файла; оба значения разделены в manifest.

## Полезность и границы

GO для сохранения этого небольшого app regression fixture; NO-GO для расширения в общую Token-2022 библиотеку или интерфейс. Он связывает account-data seed, отсутствующий ATA, атомарное создание и rollback в одном воспроизводимом cross-client примере. Клиентская проблема уже описана upstream; новым открытием она не заявляется. Workaround — explicit extra accounts в приложении, которое точно знает будущего owner. Это не универсальный resolver и не patch выпущенных SDK.

Проверка upstream 8 октября 2026:

- [PR #1347](https://github.com/solana-program/token-2022/pull/1347) open/unmerged, head `9940b1894c832f11160a7bc98e5f0cb2af07bd14`: optional preloaded data только legacy, три mocked resolver tests.
- В [legacy source 0.4.15](https://github.com/solana-program/token-2022/blob/js-legacy%40v0.4.15/clients/js-legacy/src/extensions/transferHook/seeds.ts#L60-L83) и [Kit source 0.19.0](https://github.com/solana-program/token-2022/blob/js%40v0.19.0/clients/js/src/transferHookExtraAccountMetas.ts#L398-L416) missing-account lookup выбрасывает ошибку.
- В [текущем upstream LiteSVM test](https://github.com/solana-program/token-2022/blob/385831f47aabd033a08a89a037a7b6ba3806c148/clients/js/test/extensions/transferHook/transferCheckedWithTransferHook.test.ts) уже выполняется настоящий hook CPI с existing accounts и literal extra account. [Resolver tests](https://github.com/solana-program/token-2022/blob/385831f47aabd033a08a89a037a7b6ba3806c148/clients/js/test/extensions/transferHook/extraAccountMetas.test.ts) также широко покрывают seeds. В проверенных релевантных файлах эквивалентный полный восьмисценарный fixture не найден; исчерпывающий поиск всех сторонних проектов не проводился.
- [#1543](https://github.com/solana-program/token-2022/pull/1543) / [#1544](https://github.com/solana-program/token-2022/pull/1544) исправляют другой случай: hook без optional validation account. Этот fixture всегда имеет validation PDA.
- Общие интеграционные тесты уже есть у [integration-guard](https://github.com/mohit-1710/token2022-integration-guard), fixture replay/builders у [Mollusk](https://github.com/anza-xyz/mollusk), Rust-to-Java conformance у [Sava](https://github.com/sava-software/sava). Утверждение о новизне общего тестирования не делается.

## Лицензии

Новый код стенда: MIT, см. `LICENSE`. Upstream Token-2022 и transfer-hook fixtures: Apache-2.0; их лицензии не меняются. Binaries не включены в Git: download script использует официальные upstream URLs, с атрибуцией выше. [Token-2022 license](https://github.com/solana-program/token-2022/blob/main/LICENSE), [transfer-hook license](https://github.com/solana-program/transfer-hook/blob/main/LICENSE), [program 11.0.0 release](https://github.com/solana-program/token-2022/releases/tag/program%40v11.0.0).

Keypairs — детерминированные локальные fixtures, созданные из строки `LOCAL TEST ONLY`; реальные ключи и credentials не используются и не сохраняются.
