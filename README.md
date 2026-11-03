# VNC Viewer · 3D Ar Condicionado

Acesso remoto aos computadores da empresa pelo navegador, com a identidade visual da
[3D Ar Condicionado](https://3darcondicionado.com.br/). Este viewer se conecta a computadores que rodam o
[TightVNC Server](https://www.tightvnc.com) (gratuito e de código aberto). O cliente usa o
[noVNC](https://github.com/novnc/noVNC), que implementa o protocolo RFB e a codificação *Tight* do TightVNC.

## Instalar (no seu computador)

1. Na página do repositório no GitHub, abra **Releases** e baixe **`VNC-Viewer-3D.exe`**.
2. Dê dois cliques nele. Abre o **assistente de instalação** (não precisa de Node.js nem de administrador):
   1. **Bem-vindo** → Avançar;
   2. **Pasta de instalação**: a sugerida é `%LOCALAPPDATA%\Programs\VNC Viewer 3D`; use **Procurar...** para escolher outra;
   3. **Atalhos e opções**: atalho na Área de Trabalho, atalho no Menu Iniciar, abrir ao concluir;
   4. **Pronto para instalar** → **Instalar** → **Concluir**.
3. Nas próximas vezes, use o atalho (ou o Menu Iniciar).

**Atualizar:** baixe o `.exe` novo e dê dois cliques. O assistente mostra "Atualizar da versão X para a Y",
mantém a pasta, os atalhos escolhidos e os computadores salvos, e fecha o programa aberto antes de substituir.

**Desinstalar:** **Configurações → Aplicativos → Aplicativos instalados → VNC Viewer 3D → Desinstalar**.
O assistente de desinstalação pergunta se quer:
- remover também o **acesso remoto a este PC** (recomendado; pede permissão de administrador);
- manter a lista de computadores salvos, para reinstalar depois.

Ele apaga só os arquivos do programa e só os atalhos que apontam para ele.

> Como o `.exe` não tem assinatura digital de empresa, o Windows pode mostrar "O Windows protegeu o computador".
> Clique em **Mais informações → Executar assim mesmo**.

O assistente é o `installer/assistente.ps1`, com as telas do próprio Windows (Windows Forms), e vai embutido no `.exe`.
Se ele não puder abrir (ex.: uma política da empresa bloqueia o PowerShell), o `.exe` instala sozinho na pasta sugerida.

### Alternativa sem o .exe

Com o Node.js instalado: baixe o projeto (**Code → Download ZIP**) e dê dois cliques em **`instalar.bat`**.
Ele cria o atalho apontando para a pasta do projeto (não mova a pasta depois).

## Deixar outras pessoas acessarem este PC

No painel **Este computador** (canto inferior esquerdo):

1. Digite a **senha de acesso** (6 a 8 caracteres) e uma **senha de administração** diferente, e clique
   em **Permitir acesso a este PC**.
2. Confirme a janela de permissão do Windows (administrador). O programa instala o TightVNC Server
   **a partir do instalador incluído no projeto** (`vendor/tightvnc`, nada é baixado). Antes de instalar,
   ele confere o SHA256 e a assinatura digital do instalador e recusa se o arquivo tiver sido alterado.
   A instalação já sai endurecida:
   - firewall liberado **só para a rede local** e só em redes de Domínio/Privadas (nunca em Wi-Fi público);
   - servidor HTTP da porta 5800 (Java viewer), transferência de arquivos e parâmetros por URL **desligados**;
   - papel de parede escondido durante o acesso (mais rápido).
3. O painel mostra o IP deste PC (clique para copiar). Passe esse IP e a **senha de acesso** para quem vai acessar.

Depois de instalado:
- **Desligar/Ligar acesso** para e inicia o serviço do TightVNC. Desligado, ninguém consegue entrar.
- **Configurar** abre as configurações do TightVNC (pede a senha de administração).

> O TightVNC recusa conexões do próprio PC por padrão, então teste o acesso a partir de outro computador.

## Preparar os computadores remotos manualmente (TightVNC Server)

1. Rode `vendor/tightvnc/tightvnc-2.8.89-gpl-setup-64bit.msi` (incluído no projeto), marcando **TightVNC Server**.
2. Na instalação, defina uma **senha de acesso remoto**.
3. A porta padrão é **5900** (o viewer aceita 5900–5999). Libere-a no Firewall do Windows só para a rede local.
4. Anote o IP do computador (`ipconfig`).

### Se estiver lento

- Na barra do viewer, troque **Velocidade** para **Rápida (rede lenta)**. A escolha fica salva.
- No PC remoto, abra o TightVNC Server (ícone perto do relógio) → **Configuration → Server** e marque
  **Hide desktop wallpaper**. Isso é o que mais ajuda.
- Ainda nessa aba, deixe **Use mirror driver** marcado (se existir) e não use um intervalo de polling menor que o padrão.
- Monitores 4K enviam muito mais dados: se der, reduza a resolução do PC remoto.
- Pela internet ou VPN sempre será mais lento que na rede interna.

## Computadores salvos (`conexoes.csv`)

Pela tela:
- **Criar:** preencha nome, grupo, IP e porta e clique em **Salvar**. É sempre um computador novo; se já existir
  outro com o mesmo IP e porta, o programa pergunta antes de substituir.
- **Conectar:** clique em ▶ (ou no nome, que só preenche o formulário).
- **Editar:** clique em ✎, altere os campos e clique em **Salvar alterações** (ou **Cancelar edição**).
- **Excluir:** clique em ✕.

Cada pessoa tem a própria lista, gravada no `conexoes.csv` da pasta onde o programa foi instalado.
Ela **não vai no `.exe` nem no repositório**: quem instala começa com a lista vazia, e o instalador
nunca cria nem altera esse arquivo. O arquivo também pode ser editado no Excel
(separador `;`; nomes começando com `= + - @` são gravados com `'` na frente para o Excel não executar fórmulas):

```csv
nome;host;porta;grupo
PC Engenharia 01;192.168.0.21;5900;Engenharia
Servidor;192.168.0.2;5900;TI
```

Se editar no Excel, clique em ↻ na tela para recarregar. As senhas **nunca** são salvas.

## Recursos

- Criar, editar e excluir computadores salvos (com grupos)
- Ajustar à janela, tela cheia e modo só visualizar
- Ctrl+Alt+Del
- Área de transferência: o botão "Colar remoto" envia o seu texto. Receber o que é copiado no remoto só com
  **Receber cópias do remoto** marcado (desligado por padrão, para o PC remoto não colocar texto no seu sem você saber)

## Tudo dentro do projeto

O programa não baixa nada da internet e não usa pacotes do npm. Todo o código de terceiros fica no repositório,
sem modificações:

| Pasta | O que é | Licença |
|---|---|---|
| `vendor/tightvnc` | Instalador oficial do TightVNC Server 2.8.89 (64 bits) | GPL v2 |
| `vendor/novnc` | noVNC 1.7.0: cliente VNC que roda no navegador | MPL 2.0 |
| `vendor/ws` | ws 8.22.1: WebSocket para Node.js | MIT |
| `public/fonts` | Fontes Barlow e Inter | SIL OFL 1.1 |

O `.exe` leva o próprio Node.js dentro, então não depende de nada instalado no PC.
(Só a alternativa com `instalar.bat` precisa do Node.js.)

O `vendor/SBOM.json` lista versão, origem e SHA256 de cada arquivo de terceiros. Para conferir:

```bash
node tools/verificar-vendor.js
```

O `build-exe.js` roda essa verificação e se recusa a gerar o `.exe` se algum arquivo tiver sido alterado.
Ao atualizar um componente de propósito, confira a origem e rode `node tools/verificar-vendor.js --gerar`.

## Segurança

**Servidor local (porta 6080)**
- Escuta **somente em `127.0.0.1`**.
- Só aceita pedidos com `Host` local (`localhost`/`127.0.0.1`), o que bloqueia DNS rebinding.
- Alterações (POST/DELETE) e o proxy WebSocket exigem `Origin` da própria página; leituras de outra origem são recusadas.
- O proxy só conecta em portas VNC (**5900–5999**).
- Cabeçalhos: CSP estrita (`default-src 'none'`, só scripts/estilos/fontes locais), `frame-ancestors 'none'` +
  `X-Frame-Options: DENY` (clickjacking), `nosniff`, `no-referrer`, COOP/CORP.

**Instalação do TightVNC Server**
- MSI verificado (SHA256 + assinatura GlavSoft) já como administrador, numa cópia em `C:\Windows\Temp`
  que um programa comum não consegue trocar.
- O script elevado vai na memória (`-EncodedCommand`), sem arquivo em `%TEMP%`; senhas não aparecem em linha de comando
  de processos comuns.
- Firewall restrito à sub-rede local; se não for possível restringir, o acesso fica **desligado**.

**Limites do protocolo VNC (TightVNC 2.8)**
- A tela e o teclado **não são criptografados** na rede e a senha tem no máximo 8 caracteres.
  Use só na rede interna; para acesso de fora, use VPN.

**Distribuição**
- O `.exe` não tem assinatura de código. Baixe só da página de Releases deste repositório e confira o SHA256
  publicado nas notas da versão:

```powershell
Get-FileHash .\VNC-Viewer-3D.exe -Algorithm SHA256
```

## Desenvolvimento

```bash
npm start                # http://localhost:6080 (não precisa de npm install)
node tools/make-icon.js  # regenera public/icon.ico
node tools/build-exe.js  # gera dist/VNC-Viewer-3D.exe
```

O `build-exe.js` usa o recurso *Single Executable Application* do próprio Node.js: junta os módulos num arquivo,
embute as páginas, o noVNC, o instalador do TightVNC e o assistente de instalação e grava tudo dentro de uma
cópia do `node.exe`, com o ícone da empresa. Nenhuma lista de computadores vai no `.exe`. Não usa ferramentas externas.
Para publicar uma versão nova, gere o `.exe` e anexe-o a um Release no GitHub.

Arquivos: `server.js` (servidor + proxy), `host.js` (TightVNC Server local), `public/` (HTML, CSS e JS),
`installer/assistente.ps1` (assistente de instalação), `exe-install.js` (o que o `.exe` faz ao abrir),
`instalar.ps1` / `instalar.bat` (alternativa sem `.exe`) e `Iniciar VNC Viewer.vbs` (usado por essa alternativa).
Rodando com `npm start`, a lista fica em `conexoes.csv` na pasta do projeto (fora do Git).
