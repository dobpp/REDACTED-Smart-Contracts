/* eslint "prettier/prettier": 0 */
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  BTRFLY,
  REDACTEDTreasury,
  ThecosomataETH,
  CurveHelper,
} from '../typechain';

describe('ThecosomataETH', function () {
  let admin: SignerWithAddress;
  let simp: SignerWithAddress;
  let keeper: SignerWithAddress;
  let thecosomata: ThecosomataETH;
  let btrfly: BTRFLY;
  let redactedTreasury: REDACTEDTreasury;
  let curveHelper: CurveHelper;
  let poolAddress: string;
  let adminRole: string;
  let keeperRole: string;

  const wethForTreasury: BigNumber = ethers.utils.parseUnits('3', 18);
  const wethForHelper: BigNumber = ethers.utils.parseUnits('2', 18);
  const btrflyForTreasury: BigNumber = ethers.utils.parseUnits('1000', 9);
  const btrflyForHelper: BigNumber = ethers.utils.parseUnits('10', 9);
  const btrflyForThecosomata: BigNumber = ethers.utils.parseUnits('10', 9);
  const redactedTreasuryWETHFloor: BigNumber = BigNumber.from(333333);
  const curveDeployerAddress: string =
    '0xf18056bbd320e96a48e3fbf8bc061322531aac99';
  const wethAddress: string = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

  before(async () => {
    const BTRFLY = await ethers.getContractFactory('BTRFLY');
    const REDACTEDTreasury = await ethers.getContractFactory(
      'REDACTEDTreasury'
    );
    const CurveHelper = await ethers.getContractFactory('CurveHelper');
    const ThecosomataETH = await ethers.getContractFactory('ThecosomataETH');

    [admin, simp, keeper] = await ethers.getSigners();

    btrfly = await BTRFLY.deploy();
    curveHelper = await CurveHelper.deploy(
      curveDeployerAddress,
      btrfly.address,
      wethAddress
    );
    redactedTreasury = await REDACTEDTreasury.deploy(
      btrfly.address,
      btrfly.address, // placeholder for ohm
      btrfly.address, // placeholder for sOhm
      btrfly.address, // placeholder for cvx
      btrfly.address, // placeholder for crv
      btrfly.address, // placeholder for bond
      1, // ohm floor
      1, // cvx floor
      1, // crv floor
      0
    );

    poolAddress = await curveHelper.poolAddress();

    // Set admin as mock minter so we can mint into thecosomata later
    const setVaultTx = await btrfly.setVault(admin.address);
    await setVaultTx.wait();

    // Unfreeze btrfly
    const unfreezeBtrflyTx = await btrfly.unFreezeToken();
    await unfreezeBtrflyTx.wait();

    thecosomata = await ThecosomataETH.deploy(
      btrfly.address,
      wethAddress,
      redactedTreasury.address,
      poolAddress
    );

    // Add WETH as reserve token for the treasury (ENUM #2)
    const queueReserveTokenTx = await redactedTreasury.queue(2, wethAddress);
    await queueReserveTokenTx.wait();
    const toggleReserveTokenTx = await redactedTreasury.toggle(
      2,
      wethAddress,
      admin.address
    );
    await toggleReserveTokenTx.wait();

    // Set floor for WETH
    const setWETHFloorTx = await redactedTreasury.setFloor(
      wethAddress,
      redactedTreasuryWETHFloor
    );
    await setWETHFloorTx.wait();

    // Give permission to thecosomata contract for reserve-management permission (ENUM #3)
    const queueManagerPermissionTx = await redactedTreasury.queue(
      3,
      thecosomata.address
    );
    await queueManagerPermissionTx.wait();
    const toggleManagerPermissionTx = await redactedTreasury.toggle(
      3,
      thecosomata.address,
      admin.address
    );
    await toggleManagerPermissionTx.wait();

    // Mint some BTRFLY for testing
    const mintBtrflyForTreasuryTx = await btrfly.mint(
      redactedTreasury.address,
      btrflyForTreasury
    );
    await mintBtrflyForTreasuryTx.wait();
    const mintBtrflyForHelperTx = await btrfly.mint(
      curveHelper.address,
      btrflyForHelper
    );
    await mintBtrflyForHelperTx.wait();

    // Mock some WETH for testing
    const wrapForTreasuryTx = await curveHelper.wrapAndTransfer(
      redactedTreasury.address,
      wethForTreasury,
      {
        value: wethForTreasury,
      }
    );
    await wrapForTreasuryTx.wait();
    const wrapForHelperTx = await curveHelper.wrapAndTransfer(
      curveHelper.address,
      wethForHelper,
      {
        value: wethForHelper,
      }
    );
    await wrapForHelperTx.wait();

    // Populate mock reserve
    const auditReserveTx = await redactedTreasury.auditReserves();
    await auditReserveTx.wait();

    // Init pool
    const initPoolTx = await curveHelper.initPool(
      wethForHelper,
      btrflyForHelper
    );
    await initPoolTx.wait();

    // Access roles
    adminRole = await thecosomata.DEFAULT_ADMIN_ROLE();
    keeperRole = await thecosomata.KEEPER_ROLE();
  });

  describe('grantKeeperRole', () => {
    it('Should grant the keeper role for a valid address', async () => {
      const keeperRoleBefore = await thecosomata.hasRole(
        keeperRole,
        keeper.address
      );

      await expect(thecosomata.grantKeeperRole(keeper.address))
        .to.emit(thecosomata, 'GrantKeeperRole')
        .withArgs(keeper.address);

      const keeperRoleAfter = await thecosomata.hasRole(
        keeperRole,
        keeper.address
      );

      expect(keeperRoleBefore).to.equal(false);
      expect(keeperRoleAfter).to.equal(true);
    });

    it('Should revert if called by non-admin', async () => {
      await expect(
        thecosomata.connect(simp).grantKeeperRole(keeper.address)
      ).to.be.revertedWith(
        `AccessControl: account ${simp.address.toLowerCase()} is missing role ${adminRole}`
      );
    });
  });

  describe('revokeDepositorRole', () => {
    it('Should revoke the keeper role from a previously granted address', async () => {
      const keeperRoleBefore = await thecosomata.hasRole(
        keeperRole,
        keeper.address
      );

      await expect(thecosomata.revokeKeeperRole(keeper.address))
        .to.emit(thecosomata, 'RevokeKeeperRole')
        .withArgs(keeper.address);

      const keeperRoleAfter = await thecosomata.hasRole(
        keeperRole,
        keeper.address
      );

      expect(keeperRoleBefore).to.equal(true);
      expect(keeperRoleAfter).to.equal(false);
    });

    it('Should revert if address is not a valid keeper', async () => {
      const hasRole = await thecosomata.hasRole(keeperRole, simp.address);

      expect(hasRole).to.equal(false);

      await expect(
        thecosomata.revokeKeeperRole(simp.address)
      ).to.be.revertedWith('Invalid address');
    });

    it('Should revert if called by non-admin', async () => {
      await expect(
        thecosomata.connect(simp).revokeKeeperRole(simp.address)
      ).to.be.revertedWith(
        `AccessControl: account ${simp.address.toLowerCase()} is missing role ${adminRole}`
      );
    });
  });

  describe('getMinimumLPAmount', () => {
    it('Should return correct minimum LP amount', async () => {
      const minLpAmount = await thecosomata.getMinimumLPAmount();

      expect(minLpAmount).to.eq(0);
    });

    it('Should return updated minimum LP amount on sufficient liquidity', async () => {
      const mintBtrflyTx = await btrfly.mint(
        thecosomata.address,
        btrflyForThecosomata
      );
      await mintBtrflyTx.wait();

      const minLpAmount = await thecosomata.getMinimumLPAmount();

      expect(minLpAmount).to.be.gt(0);
    });
  });

  describe('performUpkeep', () => {
    it('Should not perform upkeep when received lpToken is < minimum expected amount', async () => {
      // Make sure the keeper is granted keeper role first
      await thecosomata.grantKeeperRole(keeper.address);

      const minLpAmount = await thecosomata.getMinimumLPAmount();
      const invalidLpAmount = minLpAmount.mul(2);

      await expect(
        thecosomata.connect(keeper).performUpkeep(invalidLpAmount)
      ).to.be.revertedWith('Slippage');
    });

    it('Should not perform upkeep with no minimum lpToken', async () => {
      await expect(
        thecosomata.connect(keeper).performUpkeep(0)
      ).to.be.revertedWith('Invalid slippage');
    });

    it("Should add liquidity using the treasury's WETH and available BTRFLY", async () => {
      const minLpAmount = await thecosomata.getMinimumLPAmount();

      const treasuryPoolTokenBalanceBeforeUpkeep =
        await curveHelper.poolTokenBalance(redactedTreasury.address);
      await thecosomata.connect(keeper).performUpkeep(minLpAmount);
      const treasuryPoolTokenBalanceAfterUpkeep =
        await curveHelper.poolTokenBalance(redactedTreasury.address);

      expect(treasuryPoolTokenBalanceAfterUpkeep).to.be.gt(
        treasuryPoolTokenBalanceBeforeUpkeep
      );
      expect(treasuryPoolTokenBalanceAfterUpkeep).to.be.gte(minLpAmount);
    });

    it('Should add liquidity up to the ETH cap in treasury and burn the excess BTRFLY', async () => {
      // Mint 2x more BTRFLY than remaining available ETH in treasury
      const ethAmount = ethers.utils.parseUnits('1', 18);
      const mintBtrflyTx = await btrfly.mint(
        thecosomata.address,
        btrflyForThecosomata
      );
      await mintBtrflyTx.wait();

      // Calculate the equivalent amount of BTRFLY based on the remaining ETH
      // Price oracle can change based on timestamp, always fetch latest price to test
      const poolPrice = await curveHelper.poolPrice();
      const btrflyAmount = ethAmount
        .mul(ethers.utils.parseUnits('1', 18))
        .div(poolPrice)
        .div(ethers.utils.parseUnits('1', 9));
      const unusedBtrfly = btrflyForThecosomata.sub(btrflyAmount);
      const minLpAmount = await thecosomata.getMinimumLPAmount();

      await expect(thecosomata.connect(keeper).performUpkeep(minLpAmount))
        .to.emit(thecosomata, 'AddLiquidity')
        .withArgs(ethAmount, btrflyAmount, unusedBtrfly);
    });

    it('Should not perform upkeep on insufficient balance on either token', async () => {
      // Mint additional WETH to treasury
      const wrapForTreasuryTx = await curveHelper.wrapAndTransfer(
        redactedTreasury.address,
        wethForTreasury,
        {
          value: wethForTreasury,
        }
      );
      await wrapForTreasuryTx.wait();

      // Mint a very small amount of BTRFLY, which would result in 0 amount in ETH
      const mintBtrflyTx = await btrfly.mint(
        thecosomata.address,
        BigNumber.from(1)
      );
      await mintBtrflyTx.wait();
      const minLpAmount = await thecosomata.getMinimumLPAmount();

      expect(minLpAmount).to.eq(0);

      await expect(
        thecosomata.connect(keeper).performUpkeep(minLpAmount)
      ).to.be.revertedWith('Insufficient amounts');
    });
  });

  describe('withdraw', () => {
    it('Should withdraw tokens from Thecosomata', async () => {
      const thecosomataBalanceBeforeTransfer = await btrfly.balanceOf(
        thecosomata.address
      );

      const btrflyTransfer = BigNumber.from(1e9);
      const mintBtrflyTx = await btrfly.mint(
        thecosomata.address,
        btrflyTransfer
      );
      await mintBtrflyTx.wait();

      const thecosomataBalanceAfterTransfer = await btrfly.balanceOf(
        thecosomata.address
      );
      const adminBalanceBeforeWithdraw = await btrfly.balanceOf(admin.address);

      await expect(
        thecosomata.withdraw(
          btrfly.address,
          thecosomataBalanceAfterTransfer,
          admin.address
        )
      )
        .to.emit(thecosomata, 'Withdraw')
        .withArgs(
          btrfly.address,
          thecosomataBalanceAfterTransfer,
          admin.address
        );

      const adminBalanceAfterWithdraw = await btrfly.balanceOf(admin.address);
      const thecosomataBalanceAfterWithdraw = await btrfly.balanceOf(
        thecosomata.address
      );

      expect(
        thecosomataBalanceAfterTransfer.eq(
          btrflyTransfer.add(thecosomataBalanceBeforeTransfer)
        )
      ).to.equal(true);
      expect(
        adminBalanceAfterWithdraw.eq(
          adminBalanceBeforeWithdraw.add(thecosomataBalanceAfterTransfer)
        )
      ).to.equal(true);
      expect(thecosomataBalanceAfterWithdraw.eq(0)).to.equal(true);
    });

    it('Should only be callable by the owner', async () => {
      await expect(
        thecosomata.connect(simp).withdraw(btrfly.address, 1e9, simp.address)
      ).to.be.revertedWith(
        `AccessControl: account ${simp.address.toLowerCase()} is missing role ${adminRole}`
      );
    });
  });
});