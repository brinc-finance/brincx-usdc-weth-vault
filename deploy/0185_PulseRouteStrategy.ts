import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

import "@nomiclabs/hardhat-ethers";
import "hardhat-deploy";
import {
    combineVaults,
    setupVault,
    TRANSACTION_GAS_LIMITS,
} from "./0000_utils";
import { BigNumberish, BigNumber } from "ethers";

const deployStrategy = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer, uniswapV3PositionManager } = await getNamedAccounts();

    await deploy("UniV3Helper", {
        from: deployer,
        contract: "UniV3Helper",
        args: [uniswapV3PositionManager],
        log: true,
        autoMine: true,
        ...TRANSACTION_GAS_LIMITS,
    });

};

const buildSinglePositionStrategy = async (
    hre: HardhatRuntimeEnvironment,
    tokens: string[],
    mutableParams: MutableParamsStruct
) => {
    const { deployments, getNamedAccounts } = hre;
    const { log, read, execute, get, deploy } = deployments;
    const { deployer, mStrategyTreasury, uniswapV3Router, uniswapV3PositionManager } =
        await getNamedAccounts();

    tokens = tokens.map((t: string) => t.toLowerCase()).sort();
    const startNft =
        (await read("VaultRegistry", "vaultsCount")).toNumber() + 1;

    let erc20VaultNft = startNft;
    let uniV3VaultNft500 = startNft + 1;
    let erc20RootVaultNft = startNft + 2;

    const { address: uniV3Helper } = await hre.ethers.getContract(
        "UniV3Helper"
    );
    
    await setupVault(hre, erc20VaultNft, "ERC20VaultGovernance", {
      createVaultArgs: [tokens, deployer],
    });
    
    await setupVault(hre, uniV3VaultNft500, "UniV3VaultGovernance", {
        createVaultArgs: [tokens, deployer, 3000, uniV3Helper],
        delayedStrategyParams: [2],
    });


    const erc20Vault = await read(
        "VaultRegistry",
        "vaultForNft",
        erc20VaultNft
    );

    const uniV3Vault500 = await read(
        "VaultRegistry",
        "vaultForNft",
        uniV3VaultNft500
    );

    const deploymentName = "PulseRouteStrategy_WETH_USDC_500";
    const immutableParams = {
        router: uniswapV3Router,
        erc20Vault: erc20Vault,
        uniV3Vault: uniV3Vault500,
        tokens: tokens,
    } as ImmutableParamsStruct;


    console.log("ImmutableParams:", immutableParams.toString());
    console.log("MutableParams:", mutableParams.toString());

    await deploy(deploymentName, {
        from: deployer,
        contract: "PulseRouteStrategy",
        args: [uniswapV3PositionManager],
        log: true,
        autoMine: true,
        ...TRANSACTION_GAS_LIMITS,
    });

    const strategy = await hre.ethers.getContract(deploymentName);
    const { address: proxyAddress } = await deploy("PulseRouteStrategyProxy", {
        from: deployer,
        contract: "TransparentUpgradeableProxy",
        args: [
            strategy.address,
            deployer,
            []
        ],
        log: true,
        autoMine: true,
        ...TRANSACTION_GAS_LIMITS,
    });

    const erc20RootVaultGovernance = await get("ERC20RootVaultGovernance");
    for (let nft of [erc20VaultNft, uniV3VaultNft500]) {
        log("Approve nft for vault registry: " + nft.toString());
        await execute(
            "VaultRegistry",
            {
                from: deployer,
                log: true,
                autoMine: true,
                ...TRANSACTION_GAS_LIMITS,
            },
            "approve",
            erc20RootVaultGovernance.address,
            nft
        );
    }

    await combineVaults(
        hre,
        erc20RootVaultNft,
        [erc20VaultNft, uniV3VaultNft500],
        proxyAddress,
        mStrategyTreasury
    );


};

type MutableParamsStruct = {
    priceImpactD6: number;
    intervalWidth: number;
    tickNeighborhood: number;
    maxDeviationForVaultPool: number;
    timespanForAverageTick: number;
    pathZeroToOne: string;
    pathOneToZero: string;
    amount0Desired: BigNumberish;
    amount1Desired: BigNumberish;
    swapSlippageD: BigNumberish;
    minSwapAmounts: BigNumberish[];
};

type ImmutableParamsStruct = {
    router: string;
    erc20Vault: string;
    uniV3Vault: string;
    tokens: string[];
};

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { weth, usdc } = await getNamedAccounts();
    console.log("weth",weth);
    console.log("usdc",usdc);

    await deployStrategy(hre);
    await buildSinglePositionStrategy(hre, [usdc, weth], {
        priceImpactD6: 0,
        intervalWidth: 4200,
        tickNeighborhood: 500,
        maxDeviationForVaultPool: 50,
        timespanForAverageTick: 60,
        pathZeroToOne: '0xb4fbf271143f4fbf7b91a5ded31805e42b2208d60001f407865c6e87b9f70255377e024ace6630c1eaa37f',
        pathOneToZero: '0x07865c6e87b9f70255377e024ace6630c1eaa37f0001f4b4fbf271143f4fbf7b91a5ded31805e42b2208d6',
        amount0Desired: 1000000000,
        amount1Desired: 1000000,
        swapSlippageD: 10000000,
        minSwapAmounts: [10000000000000,10000]
    } as MutableParamsStruct);
};

export default func;

func.tags = ["PulseRouteStratey", "goerli"];
func.dependencies = [
    "VaultRegistry",
    "ERC20VaultGovernance",
    "UniV3VaultGovernance",
    "ERC20RootVaultGovernance",
];
